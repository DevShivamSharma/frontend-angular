import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';

import { IconComponent } from '../components/icon.component';

/** The first step of the PDF import: choose or drop a file, and what the import will do. */
@Component({
  selector: 'app-pdf-import-pick',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="drop"
      [class.is-over]="over()"
      (dragover)="$event.preventDefault(); over.set(true)"
      (dragleave)="over.set(false)"
      (drop)="drop($event)"
    >
      <span class="drop-icon"><app-icon name="floor-plan" [size]="28" /></span>
      <p class="drop-title">{{ over() ? 'Release to read the plan' : 'Drop a PDF plan here' }}</p>
      <p class="drop-or">or</p>
      <button type="button" class="btn-primary drop-choose" (click)="choose.emit()">
        <app-icon name="upload" [size]="16" /> Choose PDF…
      </button>
      <ul class="drop-facts">
        <li>Vector PDF exported from AutoCAD</li>
        <li>Up to 25 MB</li>
        <li>Nothing is saved until you confirm</li>
      </ul>
    </div>
    @if (error()) {
      <p class="error" role="alert"><app-icon name="alert" [size]="16" /> {{ error() }}</p>
    }
    <div class="explain">
      <section>
        <h3><app-icon name="sparkles" [size]="16" /> Read automatically</h3>
        <ul>
          <li>Stall outlines from the partition lines, as drawn: an L-shaped stall stays one L-shaped stall</li>
          <li>Open sides from the fascia lines</li>
          <li>Stall letters, areas and block numbers, checked against the drawn size</li>
          <li>The scale, from the plan’s 1 m grid; each hall on its own grid</li>
        </ul>
      </section>
      <section>
        <h3><app-icon name="shield" [size]="16" /> You confirm</h3>
        <ul>
          <li>Which planner hall it goes into, and where (auto-fit, then nudge)</li>
          <li>Every stall the drawing leaves in doubt: missing or conflicting labels, merged outlines, labels without an outline</li>
          <li>Stalls that break the planner’s rules: they are shown, never waved through</li>
        </ul>
      </section>
    </div>
  `,
  styles: `
    :host { flex: 1; overflow: auto; padding: 32px 24px; display: grid; gap: 28px; align-content: center; max-width: 880px; margin: 0 auto; width: 100%; box-sizing: border-box; }
    .drop { display: grid; justify-items: center; padding: 44px 24px 36px; border: 1.5px dashed var(--border-default); border-radius: 14px; background: var(--surface-sidebar); text-align: center; color: var(--text-secondary); transition: border-color var(--transition), background var(--transition); }
    .drop:hover { border-color: var(--border-strong); }
    .drop.is-over { border-color: var(--accent); border-style: solid; background: var(--surface-selected); }
    .drop-icon { display: grid; place-items: center; width: 60px; height: 60px; margin-bottom: 16px; border-radius: 50%; background: var(--surface-selected); color: var(--accent); transition: transform 200ms cubic-bezier(0.22, 1, 0.36, 1); }
    .drop.is-over .drop-icon { transform: translateY(-3px) scale(1.06); background: var(--surface-card); }
    .drop p { margin: 0; }
    .drop-title { font-size: 18px; font-weight: 650; letter-spacing: -0.015em; color: var(--text-primary); }
    .drop .drop-or { margin: 6px 0 12px; font-size: 13px; color: var(--text-muted); }
    .drop-choose { flex: none; min-height: 42px; padding: 0 20px; font-size: 14px; }
    .drop-facts { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 18px; margin: 20px 0 0; padding: 0; list-style: none; font-size: 12.5px; color: var(--text-muted); }
    .drop-facts li { display: inline-flex; align-items: center; gap: 6px; }
    .drop-facts li::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: var(--border-strong); }
    .error { display: flex; align-items: flex-start; gap: 8px; margin: 0; padding: 12px 14px; border: 1px solid var(--danger-border); border-radius: var(--radius-md); background: var(--danger-surface); color: var(--danger-text); font-size: 13px; line-height: 1.45; }
    .error app-icon { flex: none; margin-top: 1px; }
    .explain { display: grid; grid-template-columns: 1fr 1fr; gap: 20px 40px; font-size: 13px; line-height: 1.55; color: var(--text-secondary); }
    h3 { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; font-size: 13px; font-weight: 650; color: var(--text-primary); }
    h3 app-icon { color: var(--accent); }
    ul { margin: 0; padding-left: 24px; }
    li + li { margin-top: 6px; }
    li::marker { color: var(--border-strong); }
    @media (max-width: 900px) {
      :host { padding: 20px 16px; gap: 22px; align-content: start; }
      .drop { padding: 32px 16px 28px; }
      .explain { grid-template-columns: 1fr; }
    }
  `,
})
export class PdfImportPickComponent {
  readonly error = input('');
  readonly choose = output<void>();
  readonly file = output<File>();
  readonly over = signal(false);

  drop(event: DragEvent): void {
    event.preventDefault();
    this.over.set(false);
    const f = event.dataTransfer?.files?.[0];
    if (f) this.file.emit(f);
  }
}
