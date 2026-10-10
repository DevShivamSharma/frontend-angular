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

import { AssistantApi, AssistantMessage } from '../../../core/plans/assistant-api.service';
import type { PlanContent } from '../../../core/plans/plans.models';
import { IconComponent } from '../../../shared/icon.component';
import { PlannerAgentCtx, runTool, toolLabel } from './planner-agent';

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
  template: `
    <section class="panel" aria-label="AI Assistant">
      <header class="head">
        <app-icon name="auto_awesome" class="spark" />
        <h2>AI Assistant</h2>
        <button
          type="button"
          class="icon-btn"
          (click)="toggleVoice()"
          [attr.aria-pressed]="voiceOn()"
          [attr.aria-label]="voiceOn() ? 'Stop reading answers aloud' : 'Read answers aloud'"
          [title]="voiceOn() ? 'Answers are read aloud' : 'Answers are not read aloud'"
        >
          <app-icon [name]="voiceOn() ? 'volume_up' : 'volume_off'" />
        </button>
        <button
          type="button"
          class="icon-btn"
          (click)="closed.emit()"
          aria-label="Close the assistant"
        >
          <app-icon name="close" />
        </button>
      </header>

      <div class="log" #log aria-live="polite">
        @if (!items().length) {
          <div class="empty">
            <p>
              Ask about this hall, or tell me what to do: make zones, fill them with booths, change
              booths, save, show it in 3D. Type, or press the microphone and speak in Hindi or
              English.
            </p>
            <div class="chips">
              @for (s of suggestions; track s) {
                <button type="button" class="chip" (click)="send(s)">{{ s }}</button>
              }
            </div>
          </div>
        }
        @for (item of items(); track $index; let i = $index) {
          @switch (item.kind) {
            @case ('action') {
              <p class="action" [class]="item.state">
                @switch (item.state) {
                  @case ('running') {
                    <span class="spinner" aria-hidden="true"></span>
                  }
                  @case ('ok') {
                    <app-icon name="check_circle" label="Done" />
                  }
                  @default {
                    <app-icon name="error" label="Not done" />
                  }
                }
                <span>{{ item.text }}</span>
              </p>
            }
            @case ('undo') {
              <div class="undo">
                <span>{{ item.text }}</span>
                <button
                  pButton
                  [text]="true"
                  size="small"
                  type="button"
                  (click)="undo(i)"
                  [disabled]="item.used || working()"
                >
                  <app-icon name="undo" />{{ item.used ? 'Undone' : 'Undo' }}
                </button>
              </div>
            }
            @default {
              <p class="msg" [class.me]="item.kind === 'user'">{{ item.text }}</p>
            }
          }
        }
        @if (thinking()) {
          <p class="msg typing" aria-label="The assistant is thinking">
            <span></span><span></span><span></span>
          </p>
        }
        @if (error(); as e) {
          <div class="err" role="alert">
            <span>{{ e }}</span>
            <button pButton [text]="true" size="small" type="button" (click)="retry()">
              <app-icon name="restart_alt" />Retry
            </button>
          </div>
        }
      </div>

      <form class="ask" (submit)="$event.preventDefault(); send(draft())">
        @if (canListen) {
          <button
            type="button"
            class="mic"
            [class.on]="listening()"
            (click)="toggleListen()"
            [disabled]="working()"
            [attr.aria-pressed]="listening()"
            [attr.aria-label]="listening() ? 'Stop listening' : 'Speak'"
            [title]="listening() ? 'Listening… press to stop' : 'Speak'"
          >
            <app-icon [name]="listening() ? 'stop' : 'mic'" />
          </button>
        }
        <input
          type="text"
          [ngModel]="draft()"
          (ngModelChange)="draft.set($event)"
          name="q"
          maxlength="2000"
          [placeholder]="listening() ? 'Listening…' : 'Ask, or say what to do'"
          aria-label="Your question or command"
          autocomplete="off"
        />
        @if (working()) {
          <button pButton severity="danger" type="button" (click)="stop()" aria-label="Stop">
            <app-icon name="stop" />
          </button>
        } @else {
          <button pButton type="submit" [disabled]="!draft().trim()" aria-label="Send">
            <app-icon name="send" />
          </button>
        }
      </form>
    </section>
  `,
  styles: `
    .panel {
      position: absolute;
      right: 12px;
      bottom: 12px;
      z-index: 330;
      display: grid;
      grid-template-rows: auto 1fr auto;
      width: min(400px, calc(100% - 24px));
      height: min(560px, calc(100% - 24px));
      border: 1px solid var(--app-outline-variant);
      border-radius: 14px;
      background: var(--app-surface, #fff);
      box-shadow: 0 6px 24px rgb(0 0 0 / 0.16);
      overflow: hidden;
    }
    .head {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 12px 10px 16px;
      border-bottom: 1px solid var(--app-outline-variant);
    }
    .head h2 {
      flex: 1;
      margin: 0;
      font: var(--app-title-small);
      font-weight: 700;
    }
    .spark {
      color: var(--app-primary);
    }
    .icon-btn {
      display: inline-flex;
      align-items: center;
      padding: 6px;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: #475569;
      cursor: pointer;
    }
    .icon-btn:hover {
      background: #f1f5f9;
    }
    .log {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 14px 16px;
      overflow-y: auto;
    }
    .empty p {
      margin: 0 0 10px;
      color: #475569;
      font: var(--app-body-small);
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .chip {
      padding: 6px 10px;
      border: 1px solid var(--app-outline-variant);
      border-radius: 999px;
      background: #fff;
      color: #334155;
      font: var(--app-body-small);
      cursor: pointer;
    }
    .chip:hover {
      border-color: var(--app-primary);
    }
    .msg {
      max-width: 88%;
      margin: 0;
      padding: 8px 12px;
      border-radius: 12px 12px 12px 4px;
      background: #f1f5f9;
      color: #0f172a;
      font: var(--app-body-medium);
      white-space: pre-wrap;
    }
    .msg.me {
      align-self: flex-end;
      border-radius: 12px 12px 4px 12px;
      background: #0f2a4a;
      color: #fff;
    }
    .action {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      color: #475569;
      font: var(--app-body-small);
    }
    .action.ok app-icon {
      color: #16a34a;
    }
    .action.failed {
      color: #991b1b;
    }
    .spinner {
      width: 14px;
      height: 14px;
      flex: none;
      border: 2px solid #e2e8f0;
      border-top-color: var(--app-primary);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
    .undo {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 4px 4px 10px;
      border: 1px dashed var(--app-outline-variant);
      border-radius: 8px;
      color: #475569;
      font: var(--app-body-small);
    }
    .undo span {
      flex: 1;
    }
    .typing {
      display: flex;
      gap: 4px;
    }
    .typing span {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #94a3b8;
      animation: blink 1.2s infinite;
    }
    .typing span:nth-child(2) {
      animation-delay: 0.2s;
    }
    .typing span:nth-child(3) {
      animation-delay: 0.4s;
    }
    @keyframes blink {
      50% {
        opacity: 0.3;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .typing span,
      .spinner {
        animation-duration: 2.4s;
      }
    }
    .err {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border-radius: 8px;
      background: #fef2f2;
      color: #991b1b;
      font: var(--app-body-small);
    }
    .err span {
      flex: 1;
    }
    .ask {
      display: flex;
      gap: 8px;
      padding: 10px 12px;
      border-top: 1px solid var(--app-outline-variant);
    }
    .ask input {
      flex: 1;
      min-width: 0;
      padding: 8px 12px;
      border: 1px solid var(--app-outline-variant);
      border-radius: 999px;
      font: var(--app-body-medium);
    }
    .mic {
      display: grid;
      place-items: center;
      width: 38px;
      height: 38px;
      flex: none;
      border: 1px solid var(--app-outline-variant);
      border-radius: 50%;
      background: #fff;
      color: #0f2a4a;
      cursor: pointer;
    }
    .mic.on {
      border-color: #dc2626;
      background: #fef2f2;
      color: #dc2626;
    }
  `,
})
export class PlannerAssistantComponent {
  readonly slug = input.required<string>();
  readonly eventId = input.required<string>();
  readonly hallId = input.required<string>();
  readonly ctx = input.required<PlannerAgentCtx>();
  readonly closed = output<void>();

  private readonly api = inject(AssistantApi);
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
    const ask = () =>
      firstValueFrom(this.api.turn(this.slug(), this.eventId(), this.hallId(), this.window()));
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
