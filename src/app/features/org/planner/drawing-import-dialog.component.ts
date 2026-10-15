import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { firstValueFrom } from 'rxjs';

import type { DrawingImportResult } from '../../../core/plans/drawing-import.models';
import { PlansApi } from '../../../core/plans/plans-api.service';
import { type PlanStall, stallLabel } from '../../../core/plans/plans.models';
import { dialogData, DialogRef } from '../../../core/ui/app-dialog.service';
import { IconComponent } from '../../../shared/icon.component';
import {
  type Alignment,
  autoFit,
  autoNumbers,
  bounds,
  centredAlignment,
  type FitMethod,
  importNotes,
  isNoOverride,
  notAStall,
  nudge,
  placeStalls,
  type QuarterTurn,
  type StallOverride,
  toPlanStall,
  twinNumbers,
  unnumbered,
} from './drawing-import';
import type { PlannerStore } from './planner.store';

export interface DrawingImportData {
  store: PlannerStore;
  slug: string;
  eventId: string;
  hallId: string;
  file: File;
}

/** The stalls to add, and the booths they replace (all of the hall's, when asked). */
export interface DrawingImportOutcome {
  stalls: PlanStall[];
  replacing: string[];
}

/** Server checks of the placed stalls wait for nudging to pause this long. */
const CHECK_DELAY = 500;
/** Checks without the stalls found breaking a rule, at most: as many as the import makes. */
const CHECK_ROUNDS = 4;

/**
 * Brings in the stalls of a hall's CAD plan PDF: the server reads the drawing and keeps this
 * hall's stalls (a plan of several halls is cut down; a plan of other halls is refused); here
 * they are placed on the hall's floor, checked against its rules and reviewed before anything
 * changes. An L-shaped stall comes in as its box with the cells outside it cut; only a stall
 * with a slanted edge is listed to draw by hand. One stall can be picked and moved, turned,
 * resized or left out on its own, on top of where the whole drawing goes.
 */
@Component({
  selector: 'app-drawing-import-dialog',
  imports: [DecimalPipe, FormsModule, ButtonModule, CheckboxModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="dialog-title head">
      <span class="badge" aria-hidden="true"><app-icon name="file_import" /></span>
      <span>
        Import stalls from a CAD plan
        <small class="muted">{{ data.file.name }} · {{ hallName() }}</small>
      </span>
    </header>
    <div class="dialog-content">
      @switch (state()) {
        @case ('reading') {
          <p class="reading" role="status">
            <span class="spinner" aria-hidden="true"></span>
            Reading the plan: its stall lines, grid and labels. A full hall takes a few seconds.
          </p>
        }
        @case ('failed') {
          <div class="failed" role="alert">
            <app-icon name="error" />
            <span>{{ error() }}</span>
          </div>
        }
        @default {
          @if (result(); as r) {
            <p class="match" [class.warn]="!r.hall.matchedByName">
              @if (r.hall.matchedByName) {
                <app-icon name="check_circle" />
                <span>
                  @if (r.hall.groups.length > 1) {
                    Halls {{ r.hall.groups.slice(0, -1).join(', ') }} and
                    {{ r.hall.groups.at(-1) }} of the drawing are {{ hallName() }}.
                  } @else {
                    Hall {{ r.hall.groups[0] }} of the drawing is {{ hallName() }}.
                  }
                  @if (otherHalls().length) {
                    The drawing's other halls ({{ otherHalls().join(', ') }}) are left out.
                  }
                </span>
              } @else {
                <app-icon name="warning" />
                <span>{{ r.issues[0] }}</span>
              }
            </p>
            <div class="grid">
              <div class="col">
                <!-- A click on a stall picks it to change on its own; on the floor, lets it go. -->
                <svg
                  class="preview"
                  [attr.viewBox]="viewBox()"
                  preserveAspectRatio="xMidYMid meet"
                  role="group"
                  tabindex="0"
                  [attr.aria-label]="
                    'The drawing on ' +
                    hallName() +
                    '. Pick a stall to move it on its own; arrow keys move it, Escape lets it go.'
                  "
                  (click)="pick(null)"
                  (keydown)="key($event)"
                >
                  @for (ring of floorRings(); track $index) {
                    <polygon class="floor" [attr.points]="ring" />
                  }
                  @for (b of blocked(); track $index) {
                    <rect
                      class="blocked"
                      [attr.x]="b.x"
                      [attr.y]="b.y"
                      [attr.width]="b.width"
                      [attr.height]="b.height"
                    />
                  }
                  @for (p of placed(); track p.stall.key) {
                    <polygon
                      [attr.points]="pointsOf(p.outline)"
                      [class]="'stall ' + stateOf(p)"
                      [class.picked]="picked() === p.stall.key"
                      [class.changed]="overrides().has(p.stall.key)"
                      role="button"
                      tabindex="-1"
                      [attr.aria-label]="p.stall.name"
                      [attr.aria-pressed]="picked() === p.stall.key"
                      (click)="pick(p.stall.key); $event.stopPropagation()"
                    >
                      <title>
                        {{ p.stall.name }}{{ whyOf(p).length ? ' — ' + whyOf(p).join(' ') : '' }}
                      </title>
                    </polygon>
                  }
                  @if (pickedStall(); as p) {
                    <text
                      class="tag"
                      [attr.x]="tagAt(p.outline).x"
                      [attr.y]="tagAt(p.outline).z"
                      [attr.font-size]="tagSize()"
                    >
                      {{ p.stall.name }}
                    </text>
                  }
                </svg>
                @if (pickedStall(); as p) {
                  <section class="one" [attr.aria-label]="'Change ' + p.stall.name + ' on its own'">
                    <header class="one-head">
                      <strong>{{ p.stall.name }}</strong>
                      <span class="muted small">
                        @if (p.rect) {
                          {{ p.rect.width | number: '1.0-2' }} ×
                          {{ p.rect.height | number: '1.0-2' }} m
                        }
                      </span>
                      <button
                        pButton
                        type="button"
                        size="small"
                        [text]="true"
                        class="close"
                        (click)="pick(null)"
                        aria-label="Done with this stall"
                      >
                        <app-icon name="close" />
                      </button>
                    </header>
                    <div class="controls">
                      <span class="pad" role="group" aria-label="Move this stall a metre">
                        <button
                          pButton
                          type="button"
                          size="small"
                          [text]="true"
                          (click)="shift(0, -1)"
                          aria-label="Move this stall up"
                        >
                          <app-icon name="arrow_upward" />
                        </button>
                        <button
                          pButton
                          type="button"
                          size="small"
                          [text]="true"
                          (click)="shift(-1, 0)"
                          aria-label="Move this stall left"
                        >
                          <app-icon name="arrow_back" />
                        </button>
                        <button
                          pButton
                          type="button"
                          size="small"
                          [text]="true"
                          (click)="shift(1, 0)"
                          aria-label="Move this stall right"
                        >
                          <app-icon name="arrow_forward" />
                        </button>
                        <button
                          pButton
                          type="button"
                          size="small"
                          [text]="true"
                          (click)="shift(0, 1)"
                          aria-label="Move this stall down"
                        >
                          <app-icon name="arrow_downward" />
                        </button>
                      </span>
                      <button
                        pButton
                        type="button"
                        size="small"
                        [outlined]="true"
                        (click)="turnOne()"
                        aria-label="Turn this stall a quarter clockwise"
                      >
                        <app-icon name="rotate" />Turn
                      </button>
                      @if (excluded().has(p.stall.key)) {
                        <button
                          pButton
                          type="button"
                          size="small"
                          [outlined]="true"
                          (click)="leaveOut(false)"
                        >
                          Put it back
                        </button>
                      } @else {
                        <button
                          pButton
                          type="button"
                          size="small"
                          [outlined]="true"
                          severity="danger"
                          (click)="leaveOut(true)"
                        >
                          Leave out
                        </button>
                      }
                      <button
                        pButton
                        type="button"
                        size="small"
                        [text]="true"
                        (click)="resetOne()"
                        [disabled]="!overrides().has(p.stall.key)"
                      >
                        Reset
                      </button>
                    </div>
                    @if (p.rect && !p.cutCells.length) {
                      <div class="size">
                        <label>
                          Width (m)
                          <input
                            type="number"
                            min="1"
                            step="1"
                            [ngModel]="p.rect.width"
                            (change)="resize('width', $event)"
                          />
                        </label>
                        <label>
                          Depth (m)
                          <input
                            type="number"
                            min="1"
                            step="1"
                            [ngModel]="p.rect.height"
                            (change)="resize('depth', $event)"
                          />
                        </label>
                      </div>
                    } @else if (p.rect) {
                      <p class="muted small">
                        An L-shaped stall keeps its drawn size; resize it in the planner.
                      </p>
                    }
                    @if (whyOf(p).length) {
                      <ul class="why small" aria-label="Why it is not imported">
                        @for (w of whyOf(p); track $index) {
                          <li>{{ w }}</li>
                        }
                      </ul>
                    }
                    @if (doubted(p)) {
                      @if (overrides().get(p.stall.key)?.isStall) {
                        <button
                          pButton
                          type="button"
                          size="small"
                          [outlined]="true"
                          class="confirm"
                          (click)="takeAsStall(false)"
                        >
                          Not a stall after all
                        </button>
                      } @else {
                        <button
                          pButton
                          type="button"
                          size="small"
                          class="confirm"
                          (click)="takeAsStall(true)"
                        >
                          <app-icon name="check" />It is a stall: import it
                        </button>
                      }
                    }
                    <label class="name">
                      Number
                      <input
                        type="text"
                        maxlength="60"
                        [ngModel]="nameOf(p.stall.key, p.stall.name)"
                        (change)="rename($event)"
                      />
                    </label>
                    <p class="muted small">Arrow keys move it a metre, with Shift half a metre.</p>
                  </section>
                }
                <div class="controls">
                  <button
                    pButton
                    type="button"
                    size="small"
                    [outlined]="true"
                    (click)="turnBy(90)"
                    aria-label="Turn a quarter clockwise"
                  >
                    <app-icon name="rotate" />Turn
                  </button>
                  <span class="pad" role="group" aria-label="Move the drawing half a metre">
                    <button
                      pButton
                      type="button"
                      size="small"
                      [text]="true"
                      (click)="move(0, -0.5)"
                      aria-label="Move up"
                    >
                      <app-icon name="arrow_upward" />
                    </button>
                    <button
                      pButton
                      type="button"
                      size="small"
                      [text]="true"
                      (click)="move(-0.5, 0)"
                      aria-label="Move left"
                    >
                      <app-icon name="arrow_back" />
                    </button>
                    <button
                      pButton
                      type="button"
                      size="small"
                      [text]="true"
                      (click)="move(0.5, 0)"
                      aria-label="Move right"
                    >
                      <app-icon name="arrow_forward" />
                    </button>
                    <button
                      pButton
                      type="button"
                      size="small"
                      [text]="true"
                      (click)="move(0, 0.5)"
                      aria-label="Move down"
                    >
                      <app-icon name="arrow_downward" />
                    </button>
                  </span>
                  <button pButton type="button" size="small" [text]="true" (click)="fit()">
                    <app-icon name="fit_screen" />Fit again
                  </button>
                </div>
                <p class="muted small">
                  @if (method() === 'registered') {
                    Placed where the drawing's grid matches the hall's grid: as drawn.
                  } @else {
                    Fitted on the open floor: check the position, turn or move it if needed.
                  }
                </p>
              </div>
              <div class="col">
                <dl class="stats">
                  <dt>In the drawing</dt>
                  <dd>{{ placed().length }}</dd>
                  <dt>To import</dt>
                  <dd class="ok">{{ importable().length - broken() | number }}</dd>
                  @if (broken()) {
                    <dt>Break a rule</dt>
                    <dd class="bad">{{ broken() }}</dd>
                  }
                  @if (checking()) {
                    <dt>Rules</dt>
                    <dd class="muted">checking…</dd>
                  }
                  <dt>Slanted: draw by hand</dt>
                  <dd>{{ byHand().length }}</dd>
                  <dt>No number: numbered S1, S2…</dt>
                  <dd>{{ unnumbered().length }}</dd>
                  <dt>Off the hall floor</dt>
                  <dd [class.bad]="offFloor()">{{ offFloor() }}</dd>
                </dl>
                <ul class="legend" aria-label="Colours">
                  <li><span class="key ok"></span>Imported</li>
                  <li><span class="key hand"></span>Draw by hand</li>
                  <li><span class="key bad"></span>Off the floor or breaks a rule</li>
                </ul>
                @if (byHand().length) {
                  <details>
                    <summary>{{ plural(byHand().length, 'stall') }} to draw by hand</summary>
                    <p class="small">{{ byHand().join(', ') }}</p>
                  </details>
                }
                @if (problems().length) {
                  <details>
                    <summary>{{ plural(problems().length, 'thing') }} the drawing raised</summary>
                    <ul class="small problems">
                      @for (p of problems(); track $index) {
                        <li [class.bad]="p.severity === 'error'">{{ p.text }}</li>
                      }
                    </ul>
                  </details>
                }
                @if (store.plan().stalls.length) {
                  <label class="check">
                    <p-checkbox
                      [binary]="true"
                      [ngModel]="replace()"
                      (ngModelChange)="replace.set($event)"
                    />
                    Replace the {{ store.plan().stalls.length }} booths in this hall
                  </label>
                }
              </div>
            </div>
          }
        }
      }
    </div>
    <div class="dialog-actions">
      @if (state() === 'ready') {
        <button
          pButton
          type="button"
          [text]="true"
          class="dxf"
          (click)="downloadDxf()"
          [disabled]="downloading()"
        >
          <app-icon name="download" />{{ downloading() ? 'Making DXF…' : 'Download as DXF' }}
        </button>
      }
      <button pButton [text]="true" type="button" (click)="ref.close()">Cancel</button>
      <button
        pButton
        type="button"
        (click)="use()"
        [disabled]="state() !== 'ready' || !importable().length || checking()"
      >
        Import {{ plural(importable().length - broken(), 'stall') }}
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
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: color-mix(in srgb, var(--app-primary) 14%, transparent);
      color: var(--app-primary);
      flex: 0 0 auto;
    }
    .reading,
    .failed,
    .match {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      margin: 0 0 12px;
    }
    .failed {
      padding: 12px;
      border-radius: 10px;
      background: color-mix(in srgb, var(--app-error) 10%, transparent);
      color: var(--app-error);
      font: var(--app-body-medium);
      font-weight: 600;
    }
    .match {
      color: light-dark(#15803d, #4ade80);
    }
    .match span {
      color: var(--app-on-surface);
    }
    .match.warn {
      color: light-dark(#b45309, #fbbf24);
    }
    .spinner {
      width: 18px;
      height: 18px;
      border: 2px solid var(--app-outline-variant);
      border-top-color: var(--app-primary);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      flex: 0 0 auto;
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
      gap: 20px;
    }
    @media (max-width: 760px) {
      .grid {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    .col {
      display: grid;
      gap: 10px;
      align-content: start;
      min-width: 0;
    }
    .preview {
      width: 100%;
      aspect-ratio: 4 / 3;
      border: 1px solid var(--app-outline-variant);
      border-radius: 10px;
      background: light-dark(#f1f5f9, #0f172a);
    }
    .floor {
      fill: light-dark(#fff, #1e293b);
      stroke: #94a3b8;
      stroke-width: 0.2;
    }
    .blocked {
      fill: light-dark(#fecaca, #7f1d1d);
      opacity: 0.6;
    }
    .stall {
      stroke-width: 0.12;
    }
    .stall.ok {
      fill: #86efac;
      stroke: #16a34a;
    }
    .stall.hand {
      fill: light-dark(#e2e8f0, #334155);
      stroke: #64748b;
      stroke-dasharray: 0.4 0.3;
    }
    .stall.bad {
      fill: #fca5a5;
      stroke: #dc2626;
    }
    .stall.out {
      fill: transparent;
      stroke: #94a3b8;
      stroke-dasharray: 0.4 0.3;
    }
    .stall {
      cursor: pointer;
    }
    .stall.changed {
      stroke: #0e7490;
    }
    .stall.picked {
      stroke: var(--app-primary);
      stroke-width: 0.35;
    }
    .preview:focus-visible {
      outline: 2px solid var(--app-primary);
      outline-offset: 2px;
    }
    .tag {
      fill: var(--app-on-surface);
      font-weight: 700;
      text-anchor: middle;
      dominant-baseline: middle;
      paint-order: stroke;
      stroke: light-dark(#fff, #0f172a);
      stroke-width: 0.25;
      pointer-events: none;
    }
    .one {
      display: grid;
      gap: 8px;
      padding: 10px 12px;
      border: 1px solid var(--app-outline-variant);
      border-radius: 10px;
    }
    .one-head {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .one-head .close {
      margin-left: auto;
    }
    .size {
      display: flex;
      gap: 12px;
    }
    .confirm {
      justify-self: start;
    }
    .why {
      margin: 0;
      padding-left: 18px;
      color: var(--app-error);
    }
    .name {
      display: grid;
      gap: 2px;
      font: var(--app-body-small);
    }
    .name input {
      max-width: 240px;
      padding: 4px 8px;
      border: 1px solid var(--app-outline-variant);
      border-radius: 6px;
      background: transparent;
      color: inherit;
      font: var(--app-body-medium);
    }
    .size label {
      display: grid;
      gap: 2px;
      font: var(--app-body-small);
    }
    .size input {
      width: 90px;
      padding: 4px 8px;
      border: 1px solid var(--app-outline-variant);
      border-radius: 6px;
      background: transparent;
      color: inherit;
      font: var(--app-body-medium);
    }
    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
    }
    .pad {
      display: inline-flex;
    }
    .small {
      font: var(--app-body-small);
    }
    .stats {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 4px 12px;
      margin: 0;
      font-variant-numeric: tabular-nums;
    }
    .stats dt {
      color: var(--app-on-surface-variant);
    }
    .stats dd {
      margin: 0;
      font-weight: 600;
      text-align: right;
    }
    .ok {
      color: light-dark(#15803d, #4ade80);
    }
    .bad {
      color: var(--app-error);
    }
    .legend {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-wrap: wrap;
      gap: 4px 12px;
      font: var(--app-body-small);
    }
    .legend li {
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .key {
      width: 12px;
      height: 12px;
      border-radius: 3px;
      border: 1px solid;
    }
    .key.ok {
      background: #86efac;
      border-color: #16a34a;
    }
    .key.hand {
      background: light-dark(#e2e8f0, #334155);
      border-color: #64748b;
      border-style: dashed;
    }
    .key.bad {
      background: #fca5a5;
      border-color: #dc2626;
    }
    details summary {
      cursor: pointer;
      font: var(--app-label-medium);
    }
    .problems {
      margin: 6px 0 0;
      padding-left: 18px;
      max-height: 160px;
      overflow: auto;
    }
    .check {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .dxf {
      margin-right: auto;
    }
  `,
})
export class DrawingImportDialogComponent {
  protected readonly data = dialogData<DrawingImportData>();
  protected readonly ref = inject(DialogRef);
  protected readonly store = this.data.store;
  private readonly api = inject(PlansApi);

  protected readonly state = signal<'reading' | 'failed' | 'ready'>('reading');
  protected readonly error = signal('');
  protected readonly result = signal<DrawingImportResult | null>(null);
  protected readonly alignment = signal<Alignment | null>(null);
  protected readonly method = signal<FitMethod>('fitted');
  protected readonly replace = signal(false);
  protected readonly downloading = signal(false);
  /** Stalls changed on their own, by drawing key; kept through a new alignment or fit. */
  protected readonly overrides = signal<ReadonlyMap<string, StallOverride>>(new Map());
  /** Stalls left out in the review, by drawing key. */
  protected readonly excluded = signal<ReadonlySet<string>>(new Set());
  /** The stall picked in the preview, by drawing key. */
  protected readonly picked = signal<string | null>(null);
  /** Stall keys the server says break a rule where they stand now; null while it checks. */
  private readonly breaking = signal<Map<string, string[]> | null>(new Map());
  protected readonly checking = computed(() => this.breaking() === null);
  protected readonly broken = computed(() => this.breaking()?.size ?? 0);

  protected readonly hallName = computed(() => this.store.view()?.hall.hall.name ?? 'this hall');
  private readonly floor = computed(() => this.store.floor());

  protected readonly otherHalls = computed(() => {
    const r = this.result();
    return r ? r.hall.drawingHalls.filter((g) => !r.hall.groups.includes(g)) : [];
  });

  protected readonly placed = computed(() => {
    const r = this.result();
    const a = this.alignment();
    const floor = this.floor();
    return r && a && floor
      ? placeStalls(
          r,
          r.groups.map((g) => g.group),
          a,
          floor,
          this.excluded(),
          this.overrides(),
        )
      : [];
  });
  protected readonly pickedStall = computed(
    () => this.placed().find((p) => p.stall.key === this.picked()) ?? null,
  );
  /** The stalls that become planner stalls, and the booths they replace. */
  private readonly prepared = computed(() => {
    const view = this.store.view();
    const plan = this.store.plan();
    const overrides = this.overrides();
    const keep = this.placed().filter((p) => !p.skip);
    // A number the drawing repeats would refuse both stalls: the repeats come in numbered on.
    const twins = twinNumbers(keep, overrides);
    // A stall the drawing gives no number comes in numbered S1, S2… in reading order.
    const autos = autoNumbers(keep, overrides);
    const stalls = keep.map((p) => {
      const o = overrides.get(p.stall.key);
      const twin = twins.get(p.stall.key);
      const auto = autos.get(p.stall.key);
      const stall = toPlanStall(
        p,
        plan.zones,
        view?.hall.categories ?? [],
        o?.name ?? auto ?? twin,
      );
      const notes = importNotes(p, stall, o);
      if (auto) {
        notes.unshift(`${p.stall.name} has no number in the drawing: it comes in as ${auto}.`);
      }
      if (twin) {
        notes.unshift(
          `${p.stall.name} is in the drawing twice: this one comes in as ${twin}. Check the number with the venue.`,
        );
      }
      return { key: p.stall.key, stall, notes, twin };
    });
    return { stalls, replacing: this.replace() ? plan.stalls.map((s) => s.id) : [] };
  });
  protected readonly importable = computed(() => this.prepared().stalls);
  protected readonly byHand = computed(() =>
    this.placed()
      .filter((p) => !p.rect)
      .map((p) => p.stall.name),
  );
  /** Stalls the drawing gives no number: numbered S1, S2… on import. */
  protected readonly unnumbered = computed(() =>
    this.placed()
      .filter((p) => unnumbered(p.stall))
      .map((p) => p.stall.name),
  );
  protected readonly offFloor = computed(
    () => this.placed().filter((p) => p.rect && !p.onFloor).length,
  );
  protected readonly problems = computed(() => {
    const r = this.result();
    if (!r) return [];
    const general = r.issues
      .filter((t, i) => r.hall.matchedByName || i > 0)
      .map((text) => ({ severity: 'warning', text }));
    const perStall = r.stalls.flatMap((s) =>
      s.issues
        .filter((i) => i.severity !== 'info')
        .map((i) => ({ severity: i.severity, text: `${s.name}: ${i.message}` })),
    );
    const labels = r.unresolved.map((u) => ({
      severity: 'warning',
      text: `${u.texts.join(' ')}: ${u.reason}`,
    }));
    // How the stalls come in: notches closed, areas off their labels, changes by hand.
    const imported = this.prepared().stalls.flatMap((s) =>
      s.notes.map((text) => ({ severity: 'warning', text })),
    );
    // A number the drawing gives twice: both are refused until one is numbered again.
    const seen = new Map<string, number>();
    for (const s of this.prepared().stalls) {
      const n = stallLabel(s.stall);
      seen.set(n, (seen.get(n) ?? 0) + 1);
    }
    const twice = [...seen]
      .filter(([, n]) => n > 1)
      .map(([n]) => ({
        severity: 'error',
        text: `${n} is numbered ${seen.get(n)} times: pick one and give it a new number.`,
      }));
    const left = this.placed()
      .filter((p) => this.excluded().has(p.stall.key))
      .map((p) => ({ severity: 'warning', text: `${p.stall.name} left out by hand.` }));
    return [...twice, ...general, ...perStall, ...labels, ...imported, ...left];
  });

  protected readonly floorRings = computed(() =>
    (this.floor()?.floor ?? []).map((poly) => poly[0].map((p) => p.join(',')).join(' ')),
  );
  protected readonly blocked = computed(() => this.floor()?.blocked ?? []);
  protected readonly viewBox = computed(() => {
    const f = this.floor();
    const pts = [
      ...(f?.floor ?? []).flatMap((poly) => poly[0]),
      ...this.placed().flatMap((p) => p.outline.map((q) => [q.x, q.z] as [number, number])),
    ];
    if (!pts.length) return '0 0 10 10';
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const [minX, maxX, minY, maxY] = [
      Math.min(...xs),
      Math.max(...xs),
      Math.min(...ys),
      Math.max(...ys),
    ];
    const pad = Math.max(maxX - minX, maxY - minY) * 0.03;
    return `${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`;
  });

  constructor() {
    void this.read();
    let timer: ReturnType<typeof setTimeout> | undefined;
    effect(() => {
      const prepared = this.prepared();
      untracked(() => {
        clearTimeout(timer);
        if (!prepared.stalls.length) {
          this.breaking.set(new Map());
          return;
        }
        this.breaking.set(null);
        timer = setTimeout(() => void this.check(prepared), CHECK_DELAY);
      });
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(timer));
  }

  private async read(): Promise<void> {
    const { slug, eventId, hallId, file } = this.data;
    try {
      const result = await firstValueFrom(this.api.readDrawing(slug, eventId, hallId, file));
      const floor = this.floor();
      if (!floor) throw new Error('The hall floor is not loaded.');
      this.result.set(result);
      if (!result.stalls.length) {
        this.fail('The plan has no stalls of this hall that could be read.');
        return;
      }
      this.fitNow(result);
      this.state.set('ready');
    } catch (e) {
      const err = e as { error?: { message?: string | string[] }; message?: string };
      const message = err.error?.message ?? err.message ?? 'The plan could not be read.';
      this.fail(Array.isArray(message) ? message.join(' ') : message);
    }
  }

  private fail(message: string): void {
    this.error.set(message);
    this.state.set('failed');
  }

  private fitNow(result: DrawingImportResult): void {
    const floor = this.floor();
    if (!floor) return;
    const fit = autoFit(
      result,
      result.groups.map((g) => g.group),
      floor,
    );
    this.alignment.set(fit.alignment);
    this.method.set(fit.method);
  }

  protected fit(): void {
    const r = this.result();
    if (r) this.fitNow(r);
  }

  protected turnBy(quarter: 90): void {
    const r = this.result();
    const floor = this.floor();
    const a = this.alignment();
    if (!r || !floor || !a) return;
    const rotation = ((a.rotation + quarter) % 360) as QuarterTurn;
    this.alignment.set(
      centredAlignment(
        r,
        r.groups.map((g) => g.group),
        floor,
        rotation,
      ),
    );
    this.method.set('fitted');
  }

  protected move(dx: number, dz: number): void {
    const a = this.alignment();
    if (a) this.alignment.set(nudge(a, dx, dz));
  }

  // ---- one stall on its own ---------------------------------------------------------------

  protected pick(key: string | null): void {
    this.picked.set(key);
  }

  /** Arrow keys move the picked stall a metre (Shift: half); Escape lets it go. */
  protected key(e: KeyboardEvent): void {
    if (!this.picked()) return;
    const step = e.shiftKey ? 0.5 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
    };
    if (e.key === 'Escape') {
      // Lets the stall go, not the dialog.
      e.preventDefault();
      e.stopPropagation();
      this.pick(null);
    } else if (moves[e.key]) {
      e.preventDefault();
      this.shift(...moves[e.key]);
    }
  }

  protected shift(dx: number, dz: number): void {
    this.change((o) => ({ ...o, dx: o.dx + dx, dz: o.dz + dz }));
  }

  protected turnOne(): void {
    // A turn swaps width and depth, so a size set by hand turns with it.
    this.change((o) => ({
      ...o,
      turn: (((o.turn ?? 0) + 90) % 360) as QuarterTurn,
      width: o.depth,
      depth: o.width,
    }));
  }

  protected resize(side: 'width' | 'depth', e: Event): void {
    const v = Math.round(Number((e.target as HTMLInputElement).value));
    if (!(v >= 1)) return;
    this.change((o) => ({ ...o, [side]: v }));
  }

  /** A new number for the picked stall; its drawn number, or nothing, puts the drawn one back. */
  protected rename(e: Event): void {
    const p = this.pickedStall();
    if (!p) return;
    const name = (e.target as HTMLInputElement).value.trim();
    this.change((o) => ({ ...o, name: name && name !== p.stall.name ? name : undefined }));
  }

  /** The number a stall comes in with: given by hand, numbered on as a repeat, or as drawn. */
  protected nameOf(key: string, drawn: string): string {
    return (
      this.overrides().get(key)?.name ??
      this.prepared().stalls.find((s) => s.key === key)?.twin ??
      drawn
    );
  }

  /** Whether the server doubted the outline is a stall: the review may say it is. */
  protected doubted(p: ReturnType<DrawingImportDialogComponent['placed']>[number]): boolean {
    return notAStall(p.stall) !== null;
  }

  /**
   * Takes a doubted outline as a stall, or not. Its name then loses the "(s34)" the server adds
   * to an outline with no letter, so "2F-08 (s34)" comes in as 2F-08.
   */
  protected takeAsStall(yes: boolean): void {
    const p = this.pickedStall();
    if (!p) return;
    const plain = p.stall.name.replace(/\s*\(s\d+\)$/, '').trim();
    this.change((o) => ({
      ...o,
      isStall: yes || undefined,
      name: yes && !o.name && plain && plain !== p.stall.name ? plain : yes ? o.name : undefined,
    }));
  }

  protected leaveOut(out: boolean): void {
    const key = this.picked();
    if (!key) return;
    const next = new Set(this.excluded());
    if (out) next.add(key);
    else next.delete(key);
    this.excluded.set(next);
  }

  protected resetOne(): void {
    const key = this.picked();
    if (!key) return;
    const next = new Map(this.overrides());
    next.delete(key);
    this.overrides.set(next);
  }

  /** Changes the picked stall's override; one that changes nothing is dropped. */
  private change(fn: (o: StallOverride) => StallOverride): void {
    const key = this.picked();
    if (!key) return;
    const next = new Map(this.overrides());
    const o = fn(next.get(key) ?? { dx: 0, dz: 0 });
    if (o.width === undefined) delete o.width;
    if (o.depth === undefined) delete o.depth;
    if (!o.name) delete o.name;
    if (!o.isStall) delete o.isStall;
    if (isNoOverride(o)) next.delete(key);
    else next.set(key, o);
    this.overrides.set(next);
  }

  /** Where the picked stall's number goes: the middle of its box. */
  protected tagAt(outline: Array<{ x: number; z: number }>): { x: number; z: number } {
    const b = bounds(outline);
    return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
  }

  /** The number's size in floor metres, readable whatever the hall's size. */
  protected readonly tagSize = computed(() => {
    const [, , w, h] = this.viewBox().split(' ').map(Number);
    return Math.max(w, h) / 40;
  });

  protected stateOf(p: ReturnType<DrawingImportDialogComponent['placed']>[number]): string {
    if (this.excluded().has(p.stall.key)) return 'out';
    if (!p.rect) return 'hand';
    if (!p.onFloor) return 'bad';
    // Not brought in for another reason (not a stall, no number): grey, never green.
    if (p.skip) return 'hand';
    if (this.breaking()?.has(p.stall.key)) return 'bad';
    return 'ok';
  }

  /** Why a stall is red or left out, in words; empty for one that comes in. */
  protected whyOf(p: ReturnType<DrawingImportDialogComponent['placed']>[number]): string[] {
    const why = p.skip ? [p.skip] : [];
    return [...why, ...(this.breaking()?.get(p.stall.key) ?? [])];
  }

  protected plural(n: number, word: string): string {
    return `${n.toLocaleString('en-IN')} ${word}${n === 1 ? '' : 's'}`;
  }

  protected pointsOf(outline: Array<{ x: number; z: number }>): string {
    return outline.map((p) => `${p.x},${p.z}`).join(' ');
  }

  /**
   * Asks the server which placed stalls break a rule, with the booths that stay. Checked again
   * without the ones that do, as the import leaves them out: a stall can pass only beside one
   * that is left out (an open side facing it), and fail once it is gone. Rounds as many as the
   * import's own (`PlannerStore.addPassing`), so what shows green is what comes in.
   */
  private async check(prepared: {
    stalls: Array<{ key: string; stall: PlanStall }>;
    replacing: string[];
  }): Promise<void> {
    const plan = this.store.plan();
    const kept = plan.stalls.filter((s) => !prepared.replacing.includes(s.id));
    const keyOf = new Map(prepared.stalls.map((s) => [s.stall.id, s.key]));
    // Each stall's broken rules, in the server's words, to show why it is red.
    const bad = new Map<string, string[]>();
    let stalls = prepared.stalls.map((s) => s.stall);
    for (let round = 0; round < CHECK_ROUNDS && stalls.length; round++) {
      const findings = await this.store.check(
        { ...plan, stalls: [...kept, ...stalls] },
        stalls.map((s) => s.id),
      );
      if (prepared !== this.prepared()) return;
      let found = false;
      for (const f of findings ?? []) {
        for (const id of f.ids) {
          const key = keyOf.get(id);
          if (!key) continue;
          const why = bad.get(key) ?? [];
          if (!why.includes(f.message)) why.push(f.message);
          bad.set(key, why);
          found = true;
        }
      }
      if (!found) break;
      stalls = stalls.filter((s) => !bad.has(keyOf.get(s.id)!));
    }
    this.breaking.set(bad);
  }

  protected async downloadDxf(): Promise<void> {
    const { slug, eventId, hallId, file } = this.data;
    this.downloading.set(true);
    try {
      const blob = await firstValueFrom(this.api.drawingDxf(slug, eventId, hallId, file));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name.replace(/\.pdf$/i, '') + '.dxf';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.downloading.set(false);
    }
  }

  protected use(): void {
    const prepared = this.prepared();
    const bad = this.breaking() ?? new Map<string, string[]>();
    const stalls = prepared.stalls.filter((s) => !bad.has(s.key)).map((s) => s.stall);
    if (!stalls.length) return;
    this.ref.close({ stalls, replacing: prepared.replacing } satisfies DrawingImportOutcome);
  }
}
