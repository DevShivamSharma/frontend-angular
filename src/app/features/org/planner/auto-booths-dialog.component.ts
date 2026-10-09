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
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { MultiSelectModule } from 'primeng/multiselect';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';

import type { PlanStall, StallScheme } from '../../../core/plans/plans.models';
import type { Point } from '../../../core/venues/floor-plan.models';
import { dialogData, DialogRef } from '../../../core/ui/app-dialog.service';
import { IconComponent } from '../../../shared/icon.component';
import {
  centre,
  DEFAULT_OPEN,
  fillBooths,
  newId,
  NumberStyle,
  overlaps,
  pointInRing,
  Rect,
  ringBox,
  stallNumbers,
  stallRect,
  zoneAt,
} from './planner-geometry';
import type { PlannerStore } from './planner.store';

export interface FillRegion {
  /** 'hall' or a zone id. */
  id: string;
  /** In the list: what and how large. */
  label: string;
  /** In a sentence, e.g. zone “Food court”. */
  name: string;
  ring: Point[];
}

export interface AutoBoothsData {
  store: PlannerStore;
  regions: FillRegion[];
  regionId: string;
  /** The passage width the rules ask for; the aisle starts there. */
  passage: number;
}

const SIZES = [
  { label: '3 × 3', value: '3x3' },
  { label: '3 × 4', value: '3x4' },
  { label: '4 × 4', value: '4x4' },
  { label: '6 × 3', value: '6x3' },
  { label: 'Custom', value: 'custom' },
];

/** Server checks of the preview wait for typing to pause this long. */
const CHECK_DELAY = 450;

/**
 * Fills a zone or the hall with booths of one size. The preview shows each place: green it
 * can be added, red it breaks a rule of the hall (the server says which), white left out by a
 * click. Closes with the booths to add.
 */
@Component({
  selector: 'app-auto-booths-dialog',
  imports: [
    DecimalPipe,
    FormsModule,
    ButtonModule,
    CheckboxModule,
    InputNumberModule,
    InputTextModule,
    MultiSelectModule,
    SelectModule,
    SelectButtonModule,
    IconComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="dialog-title head">
      <span class="badge" aria-hidden="true"><app-icon name="auto_awesome" /></span>
      <span>
        Auto-booths
        <small class="muted">Fill {{ region().name }} with booths</small>
      </span>
    </header>
    <div class="dialog-content grid">
      <div class="col">
        <label class="lbl" for="ab-fill">Fill</label>
        <p-select
          inputId="ab-fill"
          [options]="data.regions"
          optionLabel="label"
          optionValue="id"
          [ngModel]="regionId()"
          (ngModelChange)="regionId.set($event)"
          appendTo="body"
        />
        <span class="lbl">Booth size (m)</span>
        <p-selectbutton
          [options]="sizes"
          optionLabel="label"
          optionValue="value"
          [allowEmpty]="false"
          [ngModel]="size()"
          (ngModelChange)="pickSize($event)"
          ariaLabel="Booth size"
        />
        <div class="pair">
          <label
            >Width
            <p-inputnumber
              [ngModel]="width()"
              (ngModelChange)="custom('w', $event)"
              [min]="0.5"
              [max]="100"
              [maxFractionDigits]="2"
              [showButtons]="false"
            />
          </label>
          <label
            >Depth
            <p-inputnumber
              [ngModel]="depth()"
              (ngModelChange)="custom('d', $event)"
              [min]="0.5"
              [max]="100"
              [maxFractionDigits]="2"
            />
          </label>
          <label
            >Aisle between booths (m)
            <p-inputnumber
              [ngModel]="aisle()"
              (ngModelChange)="aisle.set($event ?? 0)"
              [min]="0"
              [max]="50"
              [maxFractionDigits]="2"
            />
          </label>
          <label
            >Margin from the edge (m)
            <p-inputnumber
              [ngModel]="margin()"
              (ngModelChange)="margin.set($event ?? 0)"
              [min]="0"
              [max]="50"
              [maxFractionDigits]="2"
            />
          </label>
        </div>
        <div class="or"><span>or</span></div>
        <label
          >Booths
          <p-inputnumber
            [ngModel]="count()"
            (ngModelChange)="count.set($event)"
            [min]="1"
            [max]="3000"
            placeholder="as many as fit"
          />
        </label>
        <p class="muted small">
          Type how many you want and exactly that many are made, filling from the top-left. Leave it
          blank to fill the area. Every booth is this size; room at the edge that cannot fit one is
          left as aisle.
        </p>
        @if (aisle() < data.passage) {
          <p class="warn small">
            <app-icon name="warning" /> The rules ask for {{ data.passage }} m in front of an open
            side; booths whose open side faces a narrower aisle cannot be added.
          </p>
        }
      </div>

      <div class="col">
        <fieldset class="pillars">
          <legend>Pillars</legend>
          <label
            >Keep booths clear of pillars by (m)
            <p-inputnumber
              [ngModel]="pillarClear()"
              (ngModelChange)="pillarClear.set($event ?? 0)"
              [min]="0"
              [max]="10"
              [maxFractionDigits]="2"
            />
          </label>
          <label class="check">
            <p-checkbox [binary]="true" [ngModel]="shift()" (ngModelChange)="shift.set($event)" />
            Shift the grid to sit between the pillars
          </label>
          <label class="check">
            <p-checkbox
              [binary]="true"
              [ngModel]="sellPillar()"
              (ngModelChange)="sellPillar.set($event)"
            />
            Sell the stands that have a pillar in them
          </label>
          <p class="muted small">
            Off, those places are skipped. Emergency exits are always kept clear.
          </p>
        </fieldset>
        <div class="pair">
          <label
            >Number prefix
            <input
              pInputText
              [ngModel]="prefix()"
              (ngModelChange)="prefix.set($event)"
              maxlength="40"
              placeholder="e.g. B-"
            />
          </label>
          <label
            >Start at
            <input
              pInputText
              [ngModel]="startAt()"
              (ngModelChange)="startAt.set($event)"
              maxlength="6"
              placeholder="next free"
            />
          </label>
          <label
            >Numbers
            <p-select
              [options]="styles"
              optionLabel="label"
              optionValue="value"
              [ngModel]="style()"
              (ngModelChange)="style.set($event)"
              appendTo="body"
            />
          </label>
          <label
            >Scheme
            <p-select
              [options]="schemes"
              optionLabel="label"
              optionValue="value"
              [ngModel]="scheme()"
              (ngModelChange)="scheme.set($event)"
              appendTo="body"
            />
          </label>
        </div>
        <label
          >Categories
          <p-multiselect
            [options]="categories()"
            optionLabel="name"
            optionValue="id"
            [ngModel]="categoryIds()"
            (ngModelChange)="categoryIds.set($event)"
            placeholder="None"
            display="chip"
            appendTo="body"
          />
        </label>
        <p class="note small">
          A booth can be in several categories. Only the categories this hall sells are offered;
          change any booth later in Properties.
        </p>
      </div>

      <aside class="col summary">
        <h3><app-icon name="grid_view" /> What this makes</h3>
        <dl>
          <dt>Here already</dt>
          <dd>{{ already() }}</dd>
          <dt>Room for more</dt>
          <dd>{{ candidates().length }}</dd>
          <dt>Cannot be placed</dt>
          <dd [class.bad]="bad().size">{{ checking() ? '…' : bad().size }}</dd>
          <dt>Each</dt>
          <dd>{{ width() }} × {{ depth() }} m · {{ width() * depth() | number: '1.0-2' }} m²</dd>
          <dt>Sellable area</dt>
          <dd>{{ chosen().length * width() * depth() | number: '1.0-0' }} m²</dd>
        </dl>
        <svg
          class="preview"
          [attr.viewBox]="viewBox()"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          [attr.aria-label]="chosen().length + ' booths to add'"
        >
          <polygon [attr.points]="regionPoints()" class="region" />
          @for (b of blocked(); track $index) {
            <rect
              [attr.x]="b.x"
              [attr.y]="b.y"
              [attr.width]="b.width"
              [attr.height]="b.height"
              class="blocked"
            />
          }
          @for (s of existing(); track s.id) {
            <rect
              [attr.x]="s.x"
              [attr.y]="s.y"
              [attr.width]="s.width"
              [attr.height]="s.depth"
              class="existing"
            />
          }
          @for (c of candidates(); track c.id) {
            <rect
              [attr.x]="c.x"
              [attr.y]="c.y"
              [attr.width]="c.width"
              [attr.height]="c.height"
              class="cand"
              [class.bad]="bad().has(c.id)"
              [class.off]="excluded().has(c.id)"
              (click)="toggle(c.id)"
            >
              <title>
                {{
                  bad().get(c.id) ??
                    (excluded().has(c.id) ? 'Left out — click to add' : 'Click to leave out')
                }}
              </title>
            </rect>
          }
        </svg>
        <p class="muted small">
          Click a place to leave it out or add it back. Red places break a rule; hover for which.
        </p>
      </aside>
    </div>
    <div class="dialog-actions">
      <button pButton [text]="true" type="button" (click)="ref.close()">Cancel</button>
      <button pButton type="button" (click)="add()" [disabled]="!chosen().length || checking()">
        Add {{ chosen().length }} {{ chosen().length === 1 ? 'booth' : 'booths' }}
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
      background: #dcfce7;
      color: #15803d;
    }
    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.1fr);
      gap: 20px;
    }
    @media (max-width: 900px) {
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
    label,
    .lbl {
      display: grid;
      gap: 4px;
      font: var(--app-label-medium);
    }
    .pair {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    :host ::ng-deep .p-inputnumber,
    :host ::ng-deep .p-inputnumber-input,
    :host ::ng-deep .p-select,
    :host ::ng-deep .p-multiselect,
    input[pInputText] {
      width: 100%;
    }
    :host ::ng-deep .p-selectbutton {
      flex-wrap: wrap;
    }
    :host ::ng-deep .p-selectbutton .p-togglebutton {
      flex: none;
      padding-inline: 10px;
      white-space: nowrap;
    }
    .or {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--app-on-surface-variant);
      font: var(--app-label-small);
      text-transform: uppercase;
    }
    .or::before,
    .or::after {
      content: '';
      flex: 1;
      border-top: 1px solid var(--app-outline-variant);
    }
    .small {
      font: var(--app-body-small);
      margin: 0;
    }
    .warn {
      color: #b45309;
    }
    .pillars {
      display: grid;
      gap: 10px;
      margin: 0;
      padding: 12px;
      border: 0;
      border-radius: 10px;
      background: #fefce8;
    }
    .pillars legend {
      float: left;
      padding: 0;
      color: #9a3412;
      font-weight: 600;
    }
    .check {
      display: flex;
      gap: 8px;
      align-items: center;
      font: var(--app-body-medium);
    }
    .note {
      padding: 10px;
      border-radius: 8px;
      background: var(--app-surface-container);
    }
    .summary {
      padding: 14px;
      border: 1px solid var(--app-outline-variant);
      border-radius: 12px;
    }
    .summary h3 {
      margin: 0;
      font: var(--app-title-small);
      display: flex;
      gap: 6px;
      align-items: center;
    }
    dl {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 4px 12px;
      margin: 0;
      font-size: 13px;
    }
    dt {
      color: var(--app-on-surface-variant);
    }
    dd {
      margin: 0;
      font-weight: 600;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    dd.bad {
      color: var(--app-error);
    }
    .preview {
      width: 100%;
      height: 260px;
      background: #f8fafc;
      border: 1px solid var(--app-outline-variant);
      border-radius: 8px;
    }
    .region {
      fill: #fff;
      stroke: #94a3b8;
      stroke-width: 0.15;
    }
    .blocked {
      fill: #cbd5e1;
    }
    .existing {
      fill: #15803d;
      opacity: 0.6;
    }
    .cand {
      fill: #86efac;
      stroke: #16a34a;
      stroke-width: 0.1;
      cursor: pointer;
    }
    .cand.bad {
      fill: #fca5a5;
      stroke: #dc2626;
    }
    .cand.off {
      fill: #fff;
      stroke: #94a3b8;
      stroke-dasharray: 0.3 0.2;
    }
  `,
})
export class AutoBoothsDialogComponent {
  protected readonly data = dialogData<AutoBoothsData>();
  protected readonly ref = inject(DialogRef);
  private readonly store = this.data.store;

  protected readonly sizes = SIZES;
  protected readonly styles = [
    { label: '1, 2, 3…', value: 'numbers' },
    { label: 'A, B, C…', value: 'letters' },
  ];
  protected readonly schemes = [
    { label: 'Shell', value: 'shell' },
    { label: 'Raw space', value: 'raw' },
  ];
  protected readonly categories = computed(() =>
    this.store.categories().filter((c) => c.status === 'active'),
  );

  protected readonly regionId = signal(this.data.regionId);
  protected readonly size = signal('3x3');
  protected readonly width = signal(3);
  protected readonly depth = signal(3);
  protected readonly aisle = signal(this.data.passage);
  protected readonly margin = signal(0);
  protected readonly count = signal<number | null>(null);
  protected readonly pillarClear = signal(0.5);
  protected readonly shift = signal(true);
  protected readonly sellPillar = signal(false);
  protected readonly prefix = signal('');
  protected readonly startAt = signal('');
  protected readonly style = signal<NumberStyle>('numbers');
  protected readonly scheme = signal<StallScheme>('shell');
  protected readonly categoryIds = signal<string[]>([]);

  protected readonly excluded = signal<Set<string>>(new Set());
  /** Places that break a rule, with the first reason. */
  protected readonly bad = signal<Map<string, string>>(new Map());
  protected readonly checking = signal(false);

  protected readonly region = computed(
    () => this.data.regions.find((r) => r.id === this.regionId()) ?? this.data.regions[0],
  );
  private readonly box = computed(() => ringBox(this.region().ring));
  protected readonly viewBox = computed(() => {
    const b = this.box();
    const pad = Math.max(b.width, b.height) * 0.03;
    return `${b.x - pad} ${b.y - pad} ${b.width + 2 * pad} ${b.height + 2 * pad}`;
  });
  protected readonly regionPoints = computed(() =>
    this.region()
      .ring.map((p) => p.join(','))
      .join(' '),
  );
  protected readonly blocked = computed(() => {
    const b = this.box();
    return (this.store.floor()?.blocked ?? []).filter((r) => overlaps(r, b));
  });
  protected readonly existing = computed(() =>
    this.store.plan().stalls.filter((s) => overlaps(stallRect(s), this.box())),
  );
  protected readonly already = computed(
    () =>
      this.existing().filter((s) => pointInRing(centre(stallRect(s)), this.region().ring)).length,
  );

  /** The places the settings make, each with an id that stays while the settings do. */
  protected readonly candidates = computed<Array<Rect & { id: string }>>(() => {
    const floor = this.store.floor();
    if (!floor) return [];
    const plan = this.store.plan();
    return fillBooths(
      {
        region: this.region().ring,
        width: this.width(),
        depth: this.depth(),
        aisle: this.aisle(),
        margin: this.margin(),
        count: this.count(),
        pillarClearance: this.pillarClear(),
        shiftForPillars: this.shift(),
        sellPillarStands: this.sellPillar(),
      },
      floor,
      plan.stalls,
      plan.seats,
    ).map((r) => ({ ...r, id: newId() }));
  });

  protected readonly chosen = computed(() =>
    this.candidates().filter((c) => !this.excluded().has(c.id) && !this.bad().has(c.id)),
  );

  constructor() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    effect(() => {
      const candidates = this.candidates();
      untracked(() => {
        this.excluded.set(new Set());
        this.bad.set(new Map());
        this.checking.set(false);
        clearTimeout(timer);
        if (candidates.length) timer = setTimeout(() => void this.check(candidates), CHECK_DELAY);
      });
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(timer));
  }

  protected pickSize(value: string): void {
    this.size.set(value);
    const m = /^(\d+)x(\d+)$/.exec(value);
    if (m) {
      this.width.set(Number(m[1]));
      this.depth.set(Number(m[2]));
    }
  }

  protected custom(which: 'w' | 'd', value: number | null): void {
    if (!value || value <= 0) return;
    (which === 'w' ? this.width : this.depth).set(value);
    const preset = `${this.width()}x${this.depth()}`;
    this.size.set(SIZES.some((s) => s.value === preset) ? preset : 'custom');
  }

  protected toggle(id: string): void {
    if (this.bad().has(id)) return;
    this.excluded.update((set) => {
      const next = new Set(set);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  /** Asks the server which places break a rule, with the plan as it is. */
  private async check(candidates: Array<Rect & { id: string }>): Promise<void> {
    this.checking.set(true);
    const stalls = this.booths(candidates);
    const plan = this.store.plan();
    const findings = await this.store.check(
      { ...plan, stalls: [...plan.stalls, ...stalls] },
      stalls.map((s) => s.id),
    );
    // Settings changed meanwhile: a newer check is on its way.
    if (candidates !== this.candidates()) return;
    this.checking.set(false);
    const bad = new Map<string, string>();
    const own = new Set(candidates.map((c) => c.id));
    for (const f of findings ?? []) {
      for (const id of f.ids) if (own.has(id) && !bad.has(id)) bad.set(id, f.message);
    }
    this.bad.set(bad);
  }

  /** The places as booths, numbered in order. */
  private booths(places: Array<Rect & { id: string }>): PlanStall[] {
    const island = this.prefix().trim() || null;
    const numbers = stallNumbers(
      this.store.plan().stalls,
      island,
      this.style(),
      places.length,
      this.startAt(),
    );
    const zones = this.store.plan().zones;
    return places.map((r, i) => ({
      id: r.id,
      zoneId: zoneAt(centre(r), zones)?.id ?? null,
      islandNumber: island,
      stallNumber: numbers[i],
      x: r.x,
      y: r.y,
      width: r.width,
      depth: r.height,
      openSides: [...DEFAULT_OPEN],
      scheme: this.scheme(),
      categoryIds: [...this.categoryIds()],
      isPremium: false,
      isBlocked: false,
      isFnb: false,
      isBranding: false,
      isHorseshoe: false,
      isMarqueeAvailable: false,
      isRestrictedForOverseas: false,
      isActive: true,
      location: null,
      description: null,
    }));
  }

  protected add(): void {
    this.ref.close(this.booths(this.chosen()));
  }
}
