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

import { AssistantApi, AssistantTurn } from '../../../core/plans/assistant-api.service';
import { IconComponent } from '../../../shared/icon.component';

/** Turns sent with each question; older ones are left out. */
const MAX_TURNS = 20;
const SUGGESTIONS = [
  'How many booths are on this plan?',
  'Is this plan published?',
  'Kaunse zone mein sabse zyada booths hain?',
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

/**
 * The planner's AI assistant: questions about this hall, typed or spoken, answered from the hall
 * and its saved plan. Answers are read aloud with the browser's own voice unless muted. Speaking
 * needs Chrome or Edge; elsewhere the microphone is not offered and typing still works.
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
          <span class="small">{{ voiceOn() ? 'Voice on' : 'Voice off' }}</span>
        </button>
        <button type="button" class="icon-btn" (click)="closed.emit()" aria-label="Close the assistant">
          <app-icon name="close" />
        </button>
      </header>

      <div class="log" #log aria-live="polite">
        @if (!turns().length) {
          <div class="empty">
            <p>
              Ask about this hall: its booths, zones, sizes or whether it is published. Type, or
              press the microphone and speak in Hindi or English.
            </p>
            <div class="chips">
              @for (s of suggestions; track s) {
                <button type="button" class="chip" (click)="send(s)">{{ s }}</button>
              }
            </div>
          </div>
        }
        @for (t of turns(); track $index) {
          <p class="msg" [class.me]="t.role === 'user'">{{ t.text }}</p>
        }
        @if (thinking()) {
          <p class="msg typing" aria-label="The assistant is answering">
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
            [attr.aria-pressed]="listening()"
            [attr.aria-label]="listening() ? 'Stop listening' : 'Speak a question'"
            [title]="listening() ? 'Listening… press to stop' : 'Speak a question'"
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
          [placeholder]="listening() ? 'Listening…' : 'Ask about this hall'"
          aria-label="Your question"
          autocomplete="off"
        />
        <button
          pButton
          type="submit"
          [disabled]="!draft().trim() || thinking()"
          aria-label="Send"
        >
          <app-icon name="send" />
        </button>
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
      width: min(380px, calc(100% - 24px));
      height: min(520px, calc(100% - 24px));
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
      gap: 4px;
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
      .typing span {
        animation: none;
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
    .small {
      font: var(--app-label-small);
    }
  `,
})
export class PlannerAssistantComponent {
  readonly slug = input.required<string>();
  readonly eventId = input.required<string>();
  readonly hallId = input.required<string>();
  readonly closed = output<void>();

  private readonly api = inject(AssistantApi);
  private readonly log = viewChild<ElementRef<HTMLElement>>('log');

  protected readonly suggestions = SUGGESTIONS;
  protected readonly turns = signal<AssistantTurn[]>([]);
  protected readonly draft = signal('');
  protected readonly thinking = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly listening = signal(false);
  protected readonly voiceOn = signal(this.speechAvailable());
  protected readonly canListen = recognitionCtor() !== null;

  private recognition: Recognition | null = null;
  private asked = 0;

  constructor() {
    // A new hall is a new conversation.
    effect(() => {
      this.hallId();
      this.turns.set([]);
      this.error.set(null);
      this.asked++;
    });
    // Keep the newest message in view.
    effect(() => {
      this.turns();
      this.thinking();
      const el = this.log()?.nativeElement;
      if (el) queueMicrotask(() => (el.scrollTop = el.scrollHeight));
    });
    inject(DestroyRef).onDestroy(() => {
      this.recognition?.stop();
      if (this.speechAvailable()) speechSynthesis.cancel();
    });
  }

  protected async send(text: string): Promise<void> {
    const q = text.trim();
    if (!q || this.thinking()) return;
    this.draft.set('');
    this.turns.update((t) => [...t, { role: 'user', text: q }]);
    await this.ask();
  }

  protected retry(): void {
    void this.ask();
  }

  /** Sends the conversation; the answer joins it and, with voice on, is read aloud. */
  private async ask(): Promise<void> {
    const ticket = ++this.asked;
    this.error.set(null);
    this.thinking.set(true);
    if (this.speechAvailable()) speechSynthesis.cancel();
    try {
      const reply = await firstValueFrom(
        this.api.ask(this.slug(), this.eventId(), this.hallId(), this.turns().slice(-MAX_TURNS)),
      );
      if (ticket !== this.asked) return;
      this.turns.update((t) => [...t, { role: 'assistant', text: reply }]);
      this.speak(reply);
    } catch (e) {
      if (ticket !== this.asked) return;
      const err = e as { error?: { message?: string } };
      this.error.set(err?.error?.message ?? 'The assistant could not answer. Try again.');
    } finally {
      if (ticket === this.asked) this.thinking.set(false);
    }
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
    const voice =
      speechSynthesis.getVoices().find((v) => v.lang === lang) ??
      speechSynthesis.getVoices().find((v) => v.lang.startsWith(hindi ? 'hi' : 'en'));
    // One utterance per sentence: long utterances stop part-way in some browsers.
    for (const sentence of text.match(/[^.!?।]+[.!?।]*/g) ?? [text]) {
      const u = new SpeechSynthesisUtterance(sentence.trim());
      u.lang = lang;
      if (voice) u.voice = voice;
      speechSynthesis.speak(u);
    }
  }

  /** Listens for one question; what was heard is sent as it is. */
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
        this.error.set('Could not hear that. Try again, or type the question.');
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
