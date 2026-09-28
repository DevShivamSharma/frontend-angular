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
      <app-icon name="upload" [size]="28" />
      <p>Drop a PDF plan here, or</p>
      <button type="button" class="btn-primary" (click)="choose.emit()">Choose PDF…</button>
      <small>Vector PDF exported from AutoCAD, up to 25 MB. Nothing is saved until you confirm.</small>
    </div>
    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }
    <div class="explain">
      <div>
        <h3>Read automatically</h3>
        <ul>
          <li>Stall outlines from the partition lines, as drawn: an L-shaped stall stays one L-shaped stall</li>
          <li>Open sides from the fascia lines</li>
          <li>Stall letters, areas and block numbers, checked against the drawn size</li>
          <li>The scale, from the plan’s 1 m grid; each hall on its own grid</li>
        </ul>
      </div>
      <div>
        <h3>You confirm</h3>
        <ul>
          <li>Which planner hall it goes into, and where (auto-fit, then nudge)</li>
          <li>Every stall the drawing leaves in doubt: missing or conflicting labels, merged outlines, labels without an outline</li>
          <li>Stalls that break the planner’s rules: they are shown, never waved through</li>
        </ul>
      </div>
    </div>
  `,
  styles: `
    :host { flex: 1; overflow: auto; padding: 24px; display: grid; gap: 18px; align-content: start; max-width: 860px; margin: 0 auto; width: 100%; box-sizing: border-box; }
    .drop { display: grid; justify-items: center; gap: 10px; padding: 36px 16px; border: 2px dashed var(--border-strong); border-radius: 12px; text-align: center; color: var(--text-secondary); }
    .drop.is-over { border-color: var(--accent); background: var(--surface-selected); }
    .drop p { margin: 0; }
    .drop small { color: var(--text-muted); }
    .error { margin: 0; padding: 10px 12px; border-radius: 8px; background: var(--danger-surface); color: var(--danger-text); }
    .explain { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; font-size: 13px; line-height: 1.5; color: var(--text-secondary); }
    h3 { margin: 0 0 6px; font-size: 12px; font-weight: 650; text-transform: uppercase; letter-spacing: .04em; }
    ul { margin: 0; padding-left: 18px; }
    @media (max-width: 900px) { .explain { grid-template-columns: 1fr; } }
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
