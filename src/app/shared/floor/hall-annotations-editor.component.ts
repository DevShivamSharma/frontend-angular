import { Component, computed, input, output, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { HallFloor } from '../../core/api/api.models';
import type { Point } from '../../core/venues/floor-plan.models';
import { AnnotationMove, ThreePlanComponent } from './three-plan.component';

export type HallAnnotations = Pick<HallFloor, 'labels' | 'iconGroups' | 'legend'>;
const HELPERS = [
  { kind: 'toilet', label: 'Toilet' },
  { kind: 'toilet-male', label: 'Toilet (Male)' },
  { kind: 'toilet-female', label: 'Toilet (Female)' },
  { kind: 'stairs', label: 'Stairs' },
  { kind: 'lift', label: 'Lift' },
  { kind: 'emergency-exit', label: 'Emergency exit' },
  { kind: 'drinking-water', label: 'Drinking water' },
  { kind: 'entry-up', label: 'Entry' },
  { kind: 'information', label: 'Information' },
];

@Component({
  selector: 'app-hall-annotations-editor',
  imports: [FormsModule, ThreePlanComponent],
  template: `
    <h3>Legends and helper text</h3>
    <p>
      Choose a helper, then drag its card or use Place on layout. Helpers can sit outside the grid.
    </p>
    <div class="toolbar">
      <label
        >Helper type
        <select
          aria-label="Helper type"
          [(ngModel)]="helperKind"
          [ngModelOptions]="{ standalone: true }"
        >
          @for (h of helpers; track h.kind) {
            <option [value]="h.kind">{{ h.label }}</option>
          }
        </select>
      </label>
      <button type="button" (click)="addHelper()" [disabled]="floor().iconGroups.length >= 200">
        Add helper
      </button>
      <button type="button" (click)="addText()" [disabled]="floor().labels.length >= 200">
        Add text label
      </button>
    </div>
    <div class="editor">
      <div class="controls">
        <h4>Helpers on this layout</h4>
        @if (!items().length) {
          <p class="muted">Add toilets, stairs, lifts or a text label above.</p>
        }
        <div class="item-list">
          @for (a of items(); track a.id) {
            <button
              type="button"
              [class.active]="selected() === a.id"
              [attr.aria-pressed]="selected() === a.id"
              (click)="select(a.id)"
            >
              {{ a.text }}
            </button>
          }
        </div>
        @if (active(); as a) {
          <label
            >Helper text
            <input
              aria-label="Helper text"
              maxlength="200"
              [ngModel]="a.text"
              [ngModelOptions]="{ standalone: true }"
              (ngModelChange)="rename($event)"
            />
          </label>
          <div class="coordinates">
            <label
              >X (metres)<input
                type="number"
                aria-label="Helper X position"
                step="0.1"
                min="-8000"
                max="8000"
                [ngModel]="a.x"
                [ngModelOptions]="{ standalone: true }"
                (ngModelChange)="coordinate('x', $event)"
            /></label>
            <label
              >Y (metres)<input
                type="number"
                aria-label="Helper Y position"
                step="0.1"
                min="-8000"
                max="8000"
                [ngModel]="a.y"
                [ngModelOptions]="{ standalone: true }"
                (ngModelChange)="coordinate('y', $event)"
            /></label>
          </div>
          <details>
            <summary>Helper size</summary>
            <div class="coordinates">
              <label
                >Width (metres)<input
                  type="number"
                  aria-label="Helper width"
                  step="0.1"
                  min="0.01"
                  max="2000"
                  [ngModel]="a.width"
                  [ngModelOptions]="{ standalone: true }"
                  (ngModelChange)="resize('width', $event)"
              /></label>
              <label
                >Height (metres)<input
                  type="number"
                  aria-label="Helper height"
                  step="0.1"
                  min="0.01"
                  max="2000"
                  [ngModel]="a.height"
                  [ngModelOptions]="{ standalone: true }"
                  (ngModelChange)="resize('height', $event)"
              /></label>
            </div>
          </details>
          <div class="toolbar">
            <button type="button" [attr.aria-pressed]="placing()" (click)="placing.set(!placing())">
              {{ placing() ? 'Cancel placement' : 'Place on layout' }}
            </button>
            <button type="button" (click)="remove()">Remove helper</button>
          </div>
        }
        <h4>Legend entries</h4>
        @for (l of floor().legend; track $index; let index = $index) {
          <div class="legend-row">
            <input
              type="color"
              aria-label="Legend colour"
              [ngModel]="l.color || '#53849d'"
              [ngModelOptions]="{ standalone: true }"
              (ngModelChange)="legendField(index, 'color', $event)"
            />
            <input
              aria-label="Legend text"
              maxlength="200"
              [ngModel]="l.label"
              [ngModelOptions]="{ standalone: true }"
              (ngModelChange)="legendField(index, 'label', $event)"
            />
            <button type="button" aria-label="Remove legend" (click)="removeLegend(index)">
              ×
            </button>
          </div>
        }
        <button type="button" (click)="addLegend()" [disabled]="floor().legend.length >= 200">
          Add legend
        </button>
      </div>
      <div class="layout">
        <div class="preview-tools">
          <strong>{{ placing() ? 'Click where this helper should go' : 'Layout preview' }}</strong>
          <button type="button" (click)="canvas?.fit()">Fit layout</button>
          <button type="button" (click)="canvas?.zoom(1.3)">Zoom in</button>
          <button type="button" (click)="canvas?.zoom(1 / 1.3)">Zoom out</button>
        </div>
        <app-three-plan
          [floor]="floor().geometry!"
          [floorInfo]="floor()"
          [editable]="false"
          [annotationsEditable]="true"
          [selectedAnnotation]="selected()"
          [draw]="placing()"
          (annotationSelect)="select($event)"
          (annotationMove)="move($event)"
          (point)="place($event)"
        />
        <p class="muted">Drag a helper to move it. Drag empty space to pan; scroll to zoom.</p>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      --plan-canvas-height: 440px;
      --plan-canvas-min-height: 340px;
    }
    h3 {
      margin-bottom: 8px;
    }
    h4 {
      margin: 12px 0;
    }
    p {
      font-size: 13px;
    }
    .muted {
      color: var(--app-on-surface-variant);
    }
    .toolbar,
    .preview-tools {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .preview-tools {
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .editor {
      display: grid;
      grid-template-columns: 240px minmax(0, 1fr);
      gap: 16px;
      margin-top: 12px;
    }
    .controls,
    .layout {
      min-width: 0;
    }
    label {
      display: grid;
      gap: 5px;
      margin: 8px 0;
      font-size: 13px;
    }
    input,
    select {
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
      padding: 8px;
      color: inherit;
      background: var(--app-surface);
      border: 1px solid var(--app-outline-variant);
      border-radius: 6px;
      font: inherit;
    }
    button {
      cursor: pointer;
      background: var(--app-surface);
      color: var(--app-primary);
      border: 1px solid var(--app-outline-variant);
      border-radius: 6px;
      padding: 8px 10px;
      font: inherit;
    }
    button.active,
    button[aria-pressed='true'] {
      background: #e8f1fb;
      color: #173349;
      border-color: #146bc4;
    }
    .item-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .coordinates {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .legend-row {
      display: flex;
      gap: 6px;
      align-items: center;
      margin: 8px 0;
    }
    .legend-row input[type='color'] {
      flex: 0 0 38px;
      height: 36px;
      padding: 3px;
    }
    @media (max-width: 760px) {
      .editor {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class HallAnnotationsEditorComponent {
  readonly floor = input.required<HallFloor>();
  readonly annotationsChange = output<HallAnnotations>();
  @ViewChild(ThreePlanComponent) canvas?: ThreePlanComponent;
  protected readonly helpers = HELPERS;
  protected helperKind = 'toilet';
  protected selected = signal('');
  protected placing = signal(false);
  protected items = computed(() => [
    ...this.floor().labels.map((l, i) => ({ ...l, id: `label:${i}` })),
    ...this.floor().iconGroups.map((g, i) => ({
      ...g,
      id: `icon:${i}`,
      text: g.icons[0]?.label ?? '',
    })),
  ]);
  protected active = computed(() => this.items().find((a) => a.id === this.selected()));
  protected select(id: string) {
    this.selected.set(id);
    this.placing.set(false);
  }
  private annotations(): HallAnnotations {
    const f = this.floor();
    return { labels: f.labels, iconGroups: f.iconGroups, legend: f.legend };
  }
  private fitAfterAdd() {
    setTimeout(() => this.canvas?.fit());
  }
  protected addHelper() {
    const f = this.floor(),
      helper = HELPERS.find((h) => h.kind === this.helperKind)!;
    const width = Math.max(6, Math.min(30, Math.max(f.width, f.depth) * 0.24));
    const height = width / 2,
      gap = height / 3;
    const columns = Math.max(1, Math.floor(f.width / (width + gap))),
      index = f.iconGroups.length;
    this.annotationsChange.emit({
      ...this.annotations(),
      iconGroups: [
        ...f.iconGroups,
        {
          x: (index % columns) * (width + gap),
          y: -(Math.floor(index / columns) + 1) * (height + gap),
          width,
          height,
          icons: [{ ...helper }],
        },
      ],
    });
    this.select(`icon:${index}`);
    this.fitAfterAdd();
  }
  protected addText() {
    const f = this.floor(),
      width = Math.max(8, Math.min(40, Math.max(f.width, f.depth) * 0.35));
    const height = width / 7.5;
    this.annotationsChange.emit({
      ...this.annotations(),
      labels: [
        ...f.labels,
        {
          text: 'Helper text',
          x: 0,
          y: f.depth + height + f.labels.length * height * 2,
          width,
          height,
        },
      ],
    });
    this.select(`label:${f.labels.length}`);
    this.fitAfterAdd();
  }
  protected move(value: AnnotationMove) {
    const [type, raw] = value.id.split(':'),
      index = Number(raw);
    const coordinates = {
      x: Math.round(Math.max(-8000, Math.min(8000, value.x)) * 100) / 100,
      y: Math.round(Math.max(-8000, Math.min(8000, value.y)) * 100) / 100,
    };
    if (![coordinates.x, coordinates.y].every(Number.isFinite)) return;
    const key = type === 'label' ? 'labels' : 'iconGroups';
    this.annotationsChange.emit({
      ...this.annotations(),
      [key]: this.floor()[key].map((a, i) => (i === index ? { ...a, ...coordinates } : a)),
    });
  }
  protected place(p: Point) {
    if (!this.selected()) return;
    this.move({ id: this.selected(), x: p[0], y: p[1] });
    this.placing.set(false);
  }
  protected coordinate(axis: 'x' | 'y', value: number) {
    const a = this.active();
    if (a) this.move({ id: a.id, x: a.x, y: a.y, [axis]: value });
  }
  protected resize(field: 'width' | 'height', value: number) {
    if (!Number.isFinite(value) || value < 0.01 || value > 2000) return;
    const [type, raw] = this.selected().split(':'),
      index = Number(raw);
    const key = type === 'label' ? 'labels' : 'iconGroups';
    this.annotationsChange.emit({
      ...this.annotations(),
      [key]: this.floor()[key].map((a, i) => (i === index ? { ...a, [field]: value } : a)),
    });
  }
  protected rename(text: string) {
    const [type, raw] = this.selected().split(':'),
      index = Number(raw);
    const a = this.annotations();
    if (type === 'label') a.labels = a.labels.map((l, i) => (i === index ? { ...l, text } : l));
    else
      a.iconGroups = a.iconGroups.map((g, i) =>
        i === index
          ? { ...g, icons: g.icons.map((icon, j) => (j === 0 ? { ...icon, label: text } : icon)) }
          : g,
      );
    this.annotationsChange.emit(a);
  }
  protected remove() {
    const [type, raw] = this.selected().split(':'),
      index = Number(raw);
    const a = this.annotations();
    if (type === 'label') a.labels = a.labels.filter((_, i) => i !== index);
    else a.iconGroups = a.iconGroups.filter((_, i) => i !== index);
    this.annotationsChange.emit(a);
    this.select('');
  }
  protected addLegend() {
    this.annotationsChange.emit({
      ...this.annotations(),
      legend: [...this.floor().legend, { label: 'New legend', color: '#53849d', showInView: true }],
    });
  }
  protected legendField(index: number, field: 'label' | 'color', value: string) {
    this.annotationsChange.emit({
      ...this.annotations(),
      legend: this.floor().legend.map((l, i) => (i === index ? { ...l, [field]: value } : l)),
    });
  }
  protected removeLegend(index: number) {
    this.annotationsChange.emit({
      ...this.annotations(),
      legend: this.floor().legend.filter((_, i) => i !== index),
    });
  }
}
