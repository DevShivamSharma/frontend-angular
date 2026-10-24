import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { firstValueFrom } from 'rxjs';

import { AssistantApiService, AssistantMessage } from '../../data/assistant-api.service';
import type { PlanContent } from '../../domain/plan.models';
import { IconComponent } from '../../../../shared/ui/icon/icon.component';
import { PlannerAgentCtx, runTool, toolLabel } from '../../domain/planner-agent';

/** Messages sent with each turn; older whole commands are left out. */
const MAX_MESSAGES = 60;
/** Turns of the model for one command: tools, their results, the next tools. */
const MAX_ROUNDS = 8;
/** A tool result the model reads, at most. */
const MAX_RESULT = 7000;
/** Longest wait for a model's free limit before giving up. */
const MAX_WAIT_S = 30;
const SUGGESTIONS = [
  'How many booths are on this plan?',
  'Zone A ko 3×3 ke booths se bhar do',
  'Make every booth in Zone B premium',
  'Show the hall in 3D',
];

/** The browser's speech recognition, where it has one (Chrome and Edge, under a prefix). */
interface Recognition {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as Record<string, RecognitionCtor | undefined>;
  return w['SpeechRecognition'] ?? w['webkitSpeechRecognition'] ?? null;
}

/** A line of the chat: words, an action the assistant took, or the offer to undo a command. */
interface LogItem {
  kind: 'user' | 'assistant' | 'action' | 'undo';
  text: string;
  state?: 'running' | 'ok' | 'failed';
  /** The plan before the command, for "Undo". */
  before?: PlanContent;
  used?: boolean;
}

/**
 * The planner's AI assistant, an agent: asked in words (typed or spoken), it answers about this
 * hall and does planner work with the planner's own tools (see planner-agent.ts), each change
 * checked against the hall's rules. Every command it changes the plan with can be undone in one
 * step. Answers are read aloud with the browser's voice unless muted; speaking needs Chrome or
 * Edge, and elsewhere typing still works.
 */
@Component({
  selector: 'app-planner-assistant',
  imports: [FormsModule, ButtonModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './planner-assistant.component.html',
  styleUrl: './planner-assistant.component.scss',
})
export class PlannerAssistantComponent {
  readonly eventId = input.required<string>();
  readonly hallId = input.required<string>();
  readonly ctx = input.required<PlannerAgentCtx>();
  readonly closed = output<void>();

  private readonly api = inject(AssistantApiService);
  private readonly logEl = viewChild<ElementRef<HTMLElement>>('log');

  protected readonly suggestions = SUGGESTIONS;
  protected readonly items = signal<LogItem[]>([]);
  protected readonly draft = signal('');
  protected readonly thinking = signal(false);
  /** A command is running: its turns and tools. */
  protected readonly working = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly listening = signal(false);
  protected readonly voiceOn = signal(this.speechAvailable());
  protected readonly canListen = recognitionCtor() !== null;

  /** The conversation as the model sees it. */
  private messages: AssistantMessage[] = [];
  private recognition: Recognition | null = null;
  /** Goes up on Stop and on a new hall, so a running command lets go. */
  private run = 0;

  constructor() {
    // A new hall is a new conversation.
    effect(() => {
      this.hallId();
      this.run++;
      this.messages = [];
      this.before = null;
      this.items.set([]);
      this.error.set(null);
      this.working.set(false);
      this.thinking.set(false);
    });
    // Keep the newest line in view.
    effect(() => {
      this.items();
      this.thinking();
      const el = this.logEl()?.nativeElement;
      if (el) queueMicrotask(() => (el.scrollTop = el.scrollHeight));
    });
    inject(DestroyRef).onDestroy(() => {
      this.run++;
      this.recognition?.stop();
      if (this.speechAvailable()) speechSynthesis.cancel();
    });
  }

  protected async send(text: string): Promise<void> {
    const q = text.trim();
    if (!q || this.working()) return;
    this.draft.set('');
    this.messages.push({ role: 'user', text: q });
    this.add({ kind: 'user', text: q });
    await this.command();
  }

  /** After an error: the conversation goes on from where it stopped. */
  protected retry(): void {
    if (!this.working()) void this.command();
  }

  protected stop(): void {
    this.run++;
    this.working.set(false);
    this.thinking.set(false);
    // Every call the model made needs an answer, or its next turn is refused.
    let lastAsk = this.messages.length - 1;
    while (lastAsk >= 0 && !this.messages[lastAsk].calls?.length) lastAsk--;
    if (lastAsk >= 0) {
      const answered = new Set(this.messages.slice(lastAsk).map((m) => m.callId));
      for (const call of this.messages[lastAsk].calls!) {
        if (!answered.has(call.id)) {
          this.messages.push({
            role: 'tool',
            callId: call.id,
            name: call.name,
            result: JSON.stringify({ ok: false, error: 'Stopped by the person.' }),
          });
        }
      }
    }
    this.items.update((list) =>
      list.map((x) => (x.state === 'running' ? { ...x, state: 'failed', text: 'Stopped' } : x)),
    );
    this.add({ kind: 'assistant', text: 'Stopped.' });
    this.finishCommand();
  }

  /** Undoes everything one command changed, as one step. */
  protected undo(index: number): void {
    const item = this.items()[index];
    if (!item?.before || item.used || this.working()) return;
    this.ctx().store.restore(item.before);
    this.items.update((list) => list.map((x, i) => (i === index ? { ...x, used: true } : x)));
    this.messages.push({ role: 'user', text: '(I undid all the changes of your last command.)' });
  }

  private before: PlanContent | null = null;

  /**
   * Turns of the model until it stops asking for tools: each tool runs here and its result goes
   * back. One command takes at most {@link MAX_ROUNDS} turns.
   */
  private async command(): Promise<void> {
    const run = ++this.run;
    const store = this.ctx().store;
    this.before ??= store.plan();
    this.working.set(true);
    this.error.set(null);
    if (this.speechAvailable()) speechSynthesis.cancel();
    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        this.thinking.set(true);
        const turn = await this.nextTurn(run);
        if (run !== this.run) return;
        this.thinking.set(false);
        this.messages.push({ role: 'assistant', text: turn.text, calls: turn.calls });
        if (turn.text) {
          this.add({ kind: 'assistant', text: turn.text });
          this.speak(turn.text);
        }
        if (!turn.calls.length) break;
        for (const call of turn.calls) {
          if (run !== this.run) return;
          const at = this.add({
            kind: 'action',
            text: `${toolLabel(call.name)}…`,
            state: 'running',
          });
          const outcome = await runTool(this.ctx(), call.name, call.args ?? {});
          if (run !== this.run) return;
          this.update(at, { text: outcome.summary, state: outcome.ok ? 'ok' : 'failed' });
          this.messages.push({
            role: 'tool',
            callId: call.id,
            name: call.name,
            result: JSON.stringify({ ok: outcome.ok, ...asObject(outcome.result) }).slice(
              0,
              MAX_RESULT,
            ),
          });
        }
        if (round === MAX_ROUNDS - 1) {
          this.add({
            kind: 'assistant',
            text: 'I stopped after several steps. Tell me how to go on.',
          });
        }
      }
      this.finishCommand();
    } catch (e) {
      if (run !== this.run) return;
      const err = e as { error?: { message?: string } };
      this.error.set(err?.error?.message ?? 'The assistant could not answer. Try again.');
    } finally {
      if (run === this.run) {
        this.working.set(false);
        this.thinking.set(false);
      }
    }
  }

  /**
   * The model's next turn. When its free limit is used up for the moment, waits as long as the
   * server says (up to {@link MAX_WAIT_S} seconds) and asks once more.
   */
  private async nextTurn(run: number) {
    const ask = () => firstValueFrom(this.api.turn(this.eventId(), this.hallId(), this.window()));
    try {
      return await ask();
    } catch (e) {
      const err = e as { status?: number; error?: { message?: string } };
      const wait = Number(/about (\d+) seconds/.exec(err?.error?.message ?? '')?.[1]) || 0;
      if (err?.status !== 429 || !wait || wait > MAX_WAIT_S || run !== this.run) throw e;
      const at = this.add({
        kind: 'action',
        text: `The free AI limit is used up; waiting ${wait} s…`,
        state: 'running',
      });
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      this.update(at, { text: 'Waited for the free AI limit', state: 'ok' });
      if (run !== this.run) throw e;
      return ask();
    }
  }

  /** When the command changed the plan, offers to undo all of it at once. */
  private finishCommand(): void {
    const before = this.before;
    this.before = null;
    if (before && this.ctx().store.plan() !== before) {
      this.add({ kind: 'undo', text: 'The assistant changed the plan.', before });
    }
  }

  /** The newest messages within the limit, starting at a command so no tool result is orphaned. */
  private window(): AssistantMessage[] {
    const all = this.messages;
    if (all.length <= MAX_MESSAGES) return all;
    let start = all.length - MAX_MESSAGES;
    while (start < all.length - 1 && all[start].role !== 'user') start++;
    return all.slice(start);
  }

  private add(item: LogItem): number {
    this.items.update((list) => [...list, item]);
    return this.items().length - 1;
  }

  private update(index: number, patch: Partial<LogItem>): void {
    this.items.update((list) => list.map((x, i) => (i === index ? { ...x, ...patch } : x)));
  }

  // ---- voice --------------------------------------------------------------------------------

  protected toggleVoice(): void {
    if (!this.speechAvailable()) return;
    this.voiceOn.update((on) => !on);
    if (!this.voiceOn()) speechSynthesis.cancel();
  }

  /** Reads an answer aloud in a voice for its script: Hindi for Devanagari, else Indian English. */
  private speak(text: string): void {
    if (!this.voiceOn() || !this.speechAvailable()) return;
    const hindi = /[ऀ-ॿ]/.test(text);
    const lang = hindi ? 'hi-IN' : 'en-IN';
    const voices = speechSynthesis.getVoices();
    const voice =
      voices.find((v) => v.lang === lang) ??
      voices.find((v) => v.lang.startsWith(hindi ? 'hi' : 'en'));
    // One utterance per sentence: long utterances stop part-way in some browsers.
    for (const sentence of text.match(/[^.!?।]+[.!?।]*/g) ?? [text]) {
      const u = new SpeechSynthesisUtterance(sentence.trim());
      u.lang = lang;
      if (voice) u.voice = voice;
      speechSynthesis.speak(u);
    }
  }

  /** Listens for one question or command; what was heard is sent as it is. */
  protected toggleListen(): void {
    if (this.listening()) {
      this.recognition?.stop();
      return;
    }
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    if (this.speechAvailable()) speechSynthesis.cancel();
    const r = new Ctor();
    // Indian English also catches Hinglish; Hindi in Devanagari is answered in Hindi.
    r.lang = navigator.language.startsWith('hi') ? 'hi-IN' : 'en-IN';
    r.interimResults = true;
    let heard = '';
    r.onresult = (e) => {
      heard = Array.from(e.results)
        .map((res) => res[0].transcript)
        .join(' ');
      this.draft.set(heard);
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.error.set('The microphone is blocked: allow it for this site in the browser.');
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        this.error.set('Could not hear that. Try again, or type it.');
      }
    };
    r.onend = () => {
      this.listening.set(false);
      this.recognition = null;
      if (heard.trim()) void this.send(heard);
    };
    this.recognition = r;
    this.listening.set(true);
    this.error.set(null);
    r.start();
  }

  private speechAvailable(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : { value: v };
}
