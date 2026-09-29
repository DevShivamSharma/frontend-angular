import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';

import { fmt } from './draft-frame';
import { DraftingService, TOGGLE_KEYS, type Toggles } from './drafting.service';

/**
 * The command line (history above, the live prompt and what is typed below) and the status bar
 * with AutoCAD's toggles on their usual F-keys and the cursor's coordinates.
 */
@Component({
  selector: 'app-draft-command-line',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div #historyBox class="history" aria-live="polite">
      @for (line of history(); track $index) { <div>{{ line }}</div> }
    </div>
    <label class="line">
      <span class="prompt">{{ promptText() }}</span>
      <input #input spellcheck="false" autocomplete="off" aria-label="Command line"
        [value]="typed()" (input)="typed.set($any($event.target).value)" />
    </label>
    <div class="status">
      <span class="coords">{{ coords() }}</span>
      @for (t of toggleList; track t.key) {
        <button type="button" [class.on]="draft.toggles()[t.key]" [attr.aria-pressed]="draft.toggles()[t.key]"
          [title]="t.label + ' (' + t.fkey + ')'" (click)="draft.toggle(t.key)">{{ t.label }}</button>
      }
      <span class="spacer"></span>
      <span>{{ summary() }}</span>
      <button type="button" class="issues" [class.bad]="issueCount() > 0" (click)="draft.engine.run('CHK')" title="Go through the rule issues (CHK)">
        {{ issueCount() ? '⚠ ' + issueCount() + ' rule issue' + (issueCount() === 1 ? '' : 's') : '✓ Rules OK' }}
      </button>
    </div>
  `,
  styles: `
    :host { display: block; background: #20262f; color: #d6dbe3; font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; border-top: 1px solid #3a4354; }
    .history { height: 64px; overflow-y: auto; padding: 4px 10px; color: #aeb7c4; white-space: pre-wrap; }
    .line { display: flex; align-items: center; gap: 6px; padding: 3px 10px; background: #161b22; border-top: 1px solid #333c4b; }
    .prompt { color: #e5e7eb; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 70%; }
    input { flex: 1; min-width: 80px; background: transparent; border: 0; outline: none; color: #fff; font: inherit; caret-color: #60a5fa; }
    .status { display: flex; align-items: center; gap: 2px; padding: 2px 8px; background: #2a3140; font-family: system-ui, sans-serif; border-top: 1px solid #3a4354; }
    .coords { min-width: 170px; color: #cbd5e1; font-family: ui-monospace, monospace; }
    .spacer { flex: 1; }
    button { font: 600 11px system-ui, sans-serif; color: #8391a5; background: none; border: 1px solid transparent; border-radius: 3px; padding: 2px 6px; cursor: pointer; }
    button.on { color: #e0ecff; background: #1e3a8a; border-color: #3b82f6; }
    .issues { color: #86efac; }
    .issues.bad { color: #fca5a5; }
  `,
})
export class DraftCommandLineComponent {
  readonly draft = inject(DraftingService);
  readonly typed = signal('');
  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('input');
  private readonly historyEl = viewChild.required<ElementRef<HTMLDivElement>>('historyBox');

  readonly toggleList: Array<{ key: keyof Toggles; label: string; fkey: string }> = (
    ['grid', 'snap', 'ortho', 'polar', 'osnap', 'dyn'] as Array<keyof Toggles>
  ).map(key => ({ key, label: key.toUpperCase(), fkey: TOGGLE_KEYS[key] }));

  readonly history = computed(() => (this.draft.version(), this.draft.engine.log.slice(-80)));
  readonly promptText = computed(() => {
    this.draft.version();
    return this.draft.engine.prompt ? this.draft.engine.prompt.text : 'Command:';
  });
  readonly coords = computed(() => {
    const c = this.draft.cursor();
    if (!c) return '';
    const u = this.draft.frame().toUser(c.point);
    return `X ${fmt(u.x)}   Y ${fmt(u.y)} m`;
  });
  readonly issueCount = computed(() => this.draft.issues().size);
  readonly summary = computed(() => {
    this.draft.version();
    const live = this.draft.engine.stalls.filter(s => s.status !== 'CANCELLED');
    const area = live.reduce((s, x) => s + x.width * x.length, 0);
    const sel = this.draft.engine.selection.size;
    return `${sel ? `${sel} selected · ` : ''}${live.length} stalls · ${fmt(area, 1)} m²`;
  });

  constructor() {
    afterRenderEffect(() => {
      this.history();
      const el = this.historyEl().nativeElement;
      el.scrollTop = el.scrollHeight;
    });
  }

  focus(): void {
    this.input().nativeElement.focus();
  }

  hasFocus(): boolean {
    return document.activeElement === this.input().nativeElement;
  }

  /** Enter / Space: hand the typed text to the engine. */
  submit(): void {
    const text = this.typed();
    this.clear();
    this.draft.engine.enter(text, this.draft.cursor()?.point ?? null);
  }

  /** The first key typed elsewhere: goes into the box at once, so the next keys follow it. */
  append(char: string): void {
    const el = this.input().nativeElement;
    el.value += char;
    this.typed.set(el.value);
    el.focus();
  }

  /**
   * Also clears the element itself: when the signal was '' before the typing too, the binding sees
   * no change and would leave the old text in the box.
   */
  clear(): void {
    this.typed.set('');
    this.input().nativeElement.value = '';
  }
}
