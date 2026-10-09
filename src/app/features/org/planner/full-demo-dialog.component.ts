import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { RadioButtonModule } from 'primeng/radiobutton';

import { DialogRef } from '../../../core/ui/app-dialog.service';
import { IconComponent } from '../../../shared/icon.component';
import type { DemoConfig, DemoDrawing, DemoSpeed } from './full-demo.service';

/**
 * Setup dialog for "Full demo: hall to 3D". Lets the user pick a drawing
 * source (sample or own file), speed, and whether to publish. Closes with
 * a DemoConfig or undefined if cancelled.
 */
@Component({
  selector: 'app-full-demo-dialog',
  imports: [FormsModule, ButtonModule, CheckboxModule, RadioButtonModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="dialog-title head">
      <span class="badge" aria-hidden="true"><app-icon name="play" /></span>
      <span>
        Full demo: hall to 3D
        <small class="muted">The whole floor-plan flow, played step by step</small>
      </span>
    </header>
    <div class="dialog-content body">
      <div class="intro">
        <p>
          A new hall named <b>"Demo hall"</b> is created, and the editor then does each step
          itself, using the same Import, Auto-zones, Save, Publish and Exhibitors as the buttons do:
        </p>
        <ol class="steps-grid">
          <li>New hall</li>
          <li>Import a drawing</li>
          <li>Auto-zones</li>
          <li>Booths in every zone</li>
          <li>One booth's details</li>
          <li>Save</li>
          <li>Publish</li>
          <li>Exhibitors (Step 6)</li>
          <li>Open in 3D</li>
          <li>Camera tour</li>
        </ol>
      </div>

      <fieldset class="section">
        <legend>Drawing to import</legend>
        <label class="radio-card" [class.on]="drawing() === 'sample'">
          <p-radioButton
            name="drawing"
            value="sample"
            [ngModel]="drawing()"
            (ngModelChange)="drawing.set($event)"
          />
          <span>
            <b>The sample hall</b>
            <small class="muted">A 72 × 48 m hall with walls, columns and exits.</small>
          </span>
        </label>
        <label class="radio-card" [class.on]="drawing() === 'file'">
          <p-radioButton
            name="drawing"
            value="file"
            [ngModel]="drawing()"
            (ngModelChange)="drawing.set($event)"
          />
          <span>
            <b>A plan of our own (PDF or DXF)</b>
            <small class="muted">For example a hall layout PDF from the architect.</small>
          </span>
        </label>
        @if (drawing() === 'file') {
          <div class="file-pick">
            <input
              type="file"
              aria-label="Choose a PDF or DXF drawing"
              accept=".pdf,.dxf,application/pdf"
              (change)="pickFile($event)"
            />
            @if (fileName()) {
              <span class="muted small">{{ fileName() }}</span>
            }
          </div>
        }
      </fieldset>

      <fieldset class="section">
        <legend>Speed</legend>
        <div class="speed-row">
          <label class="radio-card" [class.on]="speed() === 'slow'">
            <p-radioButton
              name="speed"
              value="slow"
              [ngModel]="speed()"
              (ngModelChange)="speed.set($event)"
            />
            <span>
              <b>Slow, for presenting</b>
              <small class="muted">
                About 2½ minutes.<br />Pause or Next step at any time.
              </small>
            </span>
          </label>
          <label class="radio-card" [class.on]="speed() === 'quick'">
            <p-radioButton
              name="speed"
              value="quick"
              [ngModel]="speed()"
              (ngModelChange)="speed.set($event)"
            />
            <span>
              <b>Quick</b>
              <small class="muted">About a minute.</small>
            </span>
          </label>
        </div>
      </fieldset>

      <label class="check-row">
        <p-checkbox
          [binary]="true"
          [ngModel]="alsoPublish()"
          (ngModelChange)="alsoPublish.set($event)"
        />
        <span>
          <b>Also publish the demo hall</b>
          <small class="muted">
            Publishing makes its floor plan public to exhibitors until the demo hall is
            deleted. Off by default.
          </small>
        </span>
      </label>
    </div>
    <div class="dialog-actions">
      <button pButton [text]="true" type="button" (click)="ref.close()">Cancel</button>
      <button
        pButton
        type="button"
        class="start"
        (click)="startDemo()"
        [disabled]="drawing() === 'file' && !file()"
      >
        <app-icon name="play" />Start the demo
      </button>
    </div>
  `,
  styles: `
    .head {
      display: flex;
      gap: 12px;
      align-items: center;
    }
    .head small {
      display: block;
      font: var(--app-body-small);
    }
    .badge {
      display: grid;
      place-items: center;
      width: 40px;
      height: 40px;
      flex: none;
      border-radius: 50%;
      background: #dbeafe;
      color: #1e40af;
    }
    .body {
      display: grid;
      gap: 16px;
      max-height: 60vh;
      overflow-y: auto;
    }
    .intro p {
      margin: 0 0 6px;
      font: var(--app-body-medium);
      color: #334155;
    }
    .steps-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2px 24px;
      margin: 0;
      padding-left: 20px;
      font: var(--app-body-small);
      color: #475569;
    }
    .section {
      display: grid;
      gap: 8px;
      margin: 0;
      padding: 0;
      border: 0;
    }
    .section legend {
      font: var(--app-label-medium);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #475569;
      margin-bottom: 4px;
    }
    .radio-card {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      padding: 10px 14px;
      border: 1px solid var(--app-outline-variant);
      border-radius: 10px;
      cursor: pointer;
      transition: border-color 0.15s, background 0.15s;
    }
    .radio-card:hover {
      background: #f8fafc;
    }
    .radio-card.on {
      border-color: var(--app-primary);
      background: #eff6ff;
    }
    .radio-card b {
      display: block;
      font: var(--app-body-medium);
      font-weight: 600;
    }
    .radio-card small {
      display: block;
      margin-top: 2px;
    }
    .speed-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .file-pick {
      padding: 8px 14px;
      border: 1px dashed var(--app-outline-variant);
      border-radius: 8px;
    }
    .check-row {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      padding: 10px 14px;
      border: 1px solid var(--app-outline-variant);
      border-radius: 10px;
      cursor: pointer;
    }
    .check-row b {
      display: block;
      font: var(--app-body-medium);
      font-weight: 600;
    }
    .check-row small {
      display: block;
      margin-top: 2px;
    }
    .start {
      gap: 6px;
    }
    .muted {
      color: #64748b;
    }
    .small {
      font: var(--app-body-small);
    }
  `,
})
export class FullDemoDialogComponent {
  protected readonly ref = inject(DialogRef);

  protected readonly drawing = signal<DemoDrawing>('sample');
  protected readonly speed = signal<DemoSpeed>('slow');
  protected readonly alsoPublish = signal(false);
  protected readonly file = signal<File | null>(null);
  protected readonly fileName = signal('');

  protected pickFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const f = input.files?.[0] ?? null;
    this.file.set(f);
    this.fileName.set(f?.name ?? '');
  }

  protected startDemo(): void {
    const config: DemoConfig = {
      speed: this.speed(),
      drawing: this.drawing(),
      file: this.file(),
      alsoPublish: this.alsoPublish(),
    };
    this.ref.close(config);
  }
}
