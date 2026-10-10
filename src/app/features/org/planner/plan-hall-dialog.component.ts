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

import type { PlanStall } from '../../../core/plans/plans.models';
import { dialogData, DialogRef } from '../../../core/ui/app-dialog.service';
import { IconComponent } from '../../../shared/icon.component';
import type { FillRegion } from './auto-booths-dialog.component';
import { ringBox } from './planner-geometry';
import {
  boothsOf,
  defaultBrief,
  Numbering,
  PlanBrief,
  PlanOption,
  planOptions,
  planSetting,
} from './planner-plan';
import type { PlannerStore } from './planner.store';

export interface PlanHallData {
  store: PlannerStore;
  regions: FillRegion[];
  regionId: string;
  /** What to start from, e.g. what the AI assistant understood. */
  brief?: Partial<PlanBrief>;
  /** Replace the booths standing in the area. */
  afresh?: boolean;
}

/** What the person chose: the booths to add, and the booths they replace. */
export interface PlanHallResult {
  stalls: PlanStall[];
  replacing: string[];
  label: string;
}

const SIZES = [
  { label: '3 × 3', value: '3x3' },
  { label: '3 × 4', value: '3x4' },
  { label: '6 × 3', value: '6x3' },
  { label: '6 × 6', value: '6x6' },
  { label: 'Custom', value: 'custom' },
];
/** Server checks of the layouts wait for typing to pause this long. */
const CHECK_DELAY = 500;

/**
 * Plans a hall (or a zone) in one go: a few choices — booth size, aisle, numbering — and the
 * planner lays the area out a few ways, the way halls are cut, each checked against the hall's
 * rules. The person picks one; it is added in one step that Undo takes back.
 */
@Component({
  selector: 'app-plan-hall-dialog',
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
        Plan {{ region().name }}
        <small class="muted">A few complete layouts to choose from, kept to the hall's rules</small>
      </span>
    </header>
    <div class="dialog-content grid">
      <div class="col">
        <label
          >Area
          <p-select
            [options]="data.regions"
            optionLabel="label"
            optionValue="id"
            [ngModel]="regionId()"
            (ngModelChange)="regionId.set($event)"
            appendTo="body"
          />
        </label>
        @if (standing()) {
          <label class="check">
            <p-checkbox [binary]="true" [ngModel]="afresh()" (ngModelChange)="afresh.set($event)" />
            Start afresh: replace the {{ standing() }} booths there now
          </label>
        }
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
              [ngModel]="brief().width"
              (ngModelChange)="set({ width: $event })"
              [min]="1"
              [max]="60"
              [maxFractionDigits]="1"
            />
          </label>
          <label
            >Depth
            <p-inputnumber
              [ngModel]="brief().depth"
              (ngModelChange)="set({ depth: $event })"
              [min]="1"
              [max]="60"
              [maxFractionDigits]="1"
            />
          </label>
          <label
            >Aisle (m)
            <p-inputnumber
              [ngModel]="brief().aisle"
              (ngModelChange)="set({ aisle: $event })"
              [min]="1"
              [max]="20"
              [maxFractionDigits]="1"
            />
          </label>
          <label
            >At most (booths)
            <p-inputnumber
              [ngModel]="brief().count"
              (ngModelChange)="set({ count: $event })"
              [min]="1"
              [max]="3000"
              placeholder="as many as fit"
            />
          </label>
        </div>
        <label
          >Lines along the side walls
          <p-select
            [options]="wallChoices"
            optionLabel="label"
            optionValue="value"
            [ngModel]="brief().wallLines"
            (ngModelChange)="set({ wallLines: $event })"
            appendTo="body"
          />
        </label>
        <label class="check">
          <p-checkbox
            [binary]="true"
            [ngModel]="brief().corners"
            (ngModelChange)="set({ corners: $event })"
          />
          Line ends open on two sides (corner booths)
        </label>
        <div class="pair">
          <label
            >Numbering
            <p-select
              [options]="numberings"
              optionLabel="label"
              optionValue="value"
              [ngModel]="brief().numbering"
              (ngModelChange)="set({ numbering: $event })"
              appendTo="body"
            />
          </label>
          <label
            >Prefix
            <input
              pInputText
              [ngModel]="brief().prefix"
              (ngModelChange)="set({ prefix: $event })"
              maxlength="20"
              placeholder="e.g. H6-"
            />
          </label>
        </div>
        <label
          >Categories
          <p-multiselect
            [options]="categories()"
            optionLabel="name"
            optionValue="id"
            [ngModel]="brief().categoryIds"
            (ngModelChange)="set({ categoryIds: $event })"
            placeholder="None"
            display="chip"
            appendTo="body"
          />
        </label>
      </div>

      <div class="col options" role="radiogroup" aria-label="Layouts">
        @if (!options().length) {
          <p class="muted">
            Nothing fits here with these booths. Try smaller booths or another area.
          </p>
        }
        @for (o of options(); track o.key; let i = $index) {
          <button
            type="button"
            class="option"
            role="radio"
            [attr.aria-checked]="chosen()?.key === o.key"
            [class.on]="chosen()?.key === o.key"
            (click)="chosenKey.set(o.key)"
          >
            <svg [attr.viewBox]="viewBox()" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
              <polygon [attr.points]="regionPoints()" class="region" />
              @for (p of o.places; track $index) {
                <rect
                  [attr.x]="p.x"
                  [attr.y]="p.y"
                  [attr.width]="p.width"
                  [attr.height]="p.height"
                  [class.corner]="p.corner"
                />
              }
            </svg>
            <span class="body">
              <b>{{ letter(i) }}. {{ o.label }}</b>
              <span class="stats">
                <span
                  ><b>{{ o.booths | number }}</b> booths</span
                >
                <span>{{ o.area | number: '1.0-0' }} m²</span>
                <span>{{ o.corners }} corner</span>
                <span [class.bad]="o.overLimit">{{ o.used | number: '1.0-0' }}% floor</span>
              </span>
              <span class="check-state" [class.bad]="!!broken().get(o.key)">
                @if (broken().has(o.key)) {
                  @if (broken().get(o.key)) {
                    {{ broken().get(o.key) }} break a rule and are left out
                  } @else {
                    Every booth keeps the hall's rules
                  }
                } @else {
                  Checking the hall's rules…
                }
              </span>
            </span>
          </button>
        }
      </div>
    </div>
    <div class="dialog-actions">
      <button pButton [text]="true" type="button" (click)="ref.close()">Cancel</button>
      <button pButton type="button" (click)="use()" [disabled]="!chosen()">
        @if (chosen(); as c) {
          Use layout {{ letter(chosenIndex()) }} ({{
            c.booths - (broken().get(c.key) ?? 0) | number
          }}
          booths)
        } @else {
          Use layout
        }
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
      background: light-dark(#dcfce7, #14532d);
      color: light-dark(#15803d, #86efac);
    }
    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr);
      gap: 20px;
    }
    @media (max-width: 860px) {
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
    .check {
      display: flex;
      gap: 8px;
      align-items: center;
      font: var(--app-body-medium);
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
    .option {
      display: grid;
      grid-template-columns: 150px minmax(0, 1fr);
      gap: 12px;
      align-items: center;
      padding: 10px;
      border: 2px solid var(--app-outline-variant);
      border-radius: 12px;
      background: var(--app-surface-container-lowest);
      color: var(--app-on-surface);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .option.on {
      border-color: var(--app-primary);
      background: color-mix(in srgb, var(--app-primary) 6%, var(--app-surface-container-lowest));
    }
    .option svg {
      width: 150px;
      height: 100px;
      background: light-dark(#f8fafc, #0f172a);
      border-radius: 6px;
    }
    .region {
      fill: light-dark(#fff, #1e293b);
      stroke: #94a3b8;
      stroke-width: 0.3;
    }
    .option rect {
      fill: #86efac;
      stroke: #16a34a;
      stroke-width: 0.15;
    }
    .option rect.corner {
      fill: #4ade80;
    }
    .body {
      display: grid;
      gap: 4px;
      min-width: 0;
    }
    .stats {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 12px;
      font: var(--app-body-small);
      font-variant-numeric: tabular-nums;
      color: var(--app-on-surface-variant);
    }
    .check-state {
      font: var(--app-body-small);
      color: light-dark(#15803d, #4ade80);
    }
    .bad {
      color: var(--app-error) !important;
    }
  `,
})
export class PlanHallDialogComponent {
  protected readonly data = dialogData<PlanHallData>();
  protected readonly ref = inject(DialogRef);
  private readonly store = this.data.store;

  protected readonly sizes = SIZES;
  protected readonly wallChoices = [
    { label: 'Try both', value: 'auto' },
    { label: 'Yes', value: 'yes' },
    { label: 'No', value: 'no' },
  ];
  protected readonly numberings: Array<{ label: string; value: Numbering }> = [
    { label: 'By line: A1, A2… B1…', value: 'line' },
    { label: 'By island: 1-A, 1-B…', value: 'island' },
    { label: 'In order: 1, 2, 3…', value: 'numbers' },
  ];
  protected readonly categories = computed(() =>
    this.store.categories().filter((c) => c.status === 'active'),
  );

  protected readonly regionId = signal(this.data.regionId);
  protected readonly region = computed(
    () => this.data.regions.find((r) => r.id === this.regionId()) ?? this.data.regions[0],
  );
  protected readonly afresh = signal(this.data.afresh ?? false);
  protected readonly brief = signal<PlanBrief>(this.startingBrief());
  protected readonly size = computed(() => {
    const preset = `${this.brief().width}x${this.brief().depth}`;
    return SIZES.some((s) => s.value === preset) ? preset : 'custom';
  });

  /** The booths standing in the area now. */
  protected readonly standing = computed(() => this.prepared()?.standing ?? 0);
  private readonly prepared = computed(() => {
    const view = this.store.view();
    const floor = this.store.floor();
    if (!view || !floor) return null;
    const plan = this.store.plan();
    const ring = this.region().ring;
    const { setting, replacing } = planSetting(view, floor, plan, ring, this.afresh());
    const standing = planSetting(view, floor, plan, ring, true).replacing.size;
    return { setting, replacing, standing, plan };
  });
  protected readonly options = computed<PlanOption[]>(() => {
    const p = this.prepared();
    return p ? planOptions(this.brief(), p.setting) : [];
  });
  protected readonly chosenKey = signal<string | null>(null);
  protected readonly chosen = computed<PlanOption | null>(
    () => this.options().find((o) => o.key === this.chosenKey()) ?? this.options()[0] ?? null,
  );
  protected readonly chosenIndex = computed(() =>
    Math.max(
      0,
      this.options().findIndex((o) => o.key === this.chosen()?.key),
    ),
  );
  /** Booths of each layout the server says break a rule; missing while it checks. */
  protected readonly broken = signal<Map<string, number>>(new Map());

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

  constructor() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    effect(() => {
      const options = this.options();
      untracked(() => {
        this.broken.set(new Map());
        if (!options.some((o) => o.key === this.chosenKey())) this.chosenKey.set(null);
        clearTimeout(timer);
        if (options.length) timer = setTimeout(() => void this.check(options), CHECK_DELAY);
      });
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(timer));
  }

  protected letter(i: number): string {
    return String.fromCharCode(65 + i);
  }

  protected set(patch: Partial<PlanBrief>): void {
    this.brief.update((b) => ({ ...b, ...patch }));
  }

  protected pickSize(value: string): void {
    const m = /^(\d+)x(\d+)$/.exec(value);
    if (m) this.set({ width: Number(m[1]), depth: Number(m[2]) });
  }

  /** Asks the server, layout by layout, how many booths break a rule. */
  private async check(options: PlanOption[]): Promise<void> {
    const p = this.prepared();
    if (!p) return;
    for (const o of options) {
      const booths = boothsOf(o, this.brief(), p.setting);
      const kept = p.plan.stalls.filter((s) => !p.replacing.has(s.id));
      const findings = await this.store.check(
        { ...p.plan, stalls: [...kept, ...booths] },
        booths.map((b) => b.id),
      );
      // The settings changed meanwhile: a newer check is on its way.
      if (options !== this.options()) return;
      const own = new Set(booths.map((b) => b.id));
      const bad = new Set((findings ?? []).flatMap((f) => f.ids).filter((id) => own.has(id)));
      this.broken.update((m) => new Map(m).set(o.key, bad.size));
    }
  }

  protected use(): void {
    const o = this.chosen();
    const p = this.prepared();
    if (!o || !p) return;
    this.ref.close({
      stalls: boothsOf(o, this.brief(), p.setting),
      replacing: [...p.replacing],
      label: o.label,
    } satisfies PlanHallResult);
  }

  private startingBrief(): PlanBrief {
    const view = this.store.view();
    const passage = view ? view.hall.rules.values.passageWidth[view.hall.event.audience] : 3;
    const base = defaultBrief({
      rules: {
        on: () => true,
        passage,
        wallClearance: 1,
        emergencyExitClearance: 3,
        curtainClearance: 1,
        facilityClearance: 1,
        maxUtilization: 0.7,
      },
    });
    const given = this.data.brief ?? {};
    return {
      ...base,
      ...Object.fromEntries(Object.entries(given).filter(([, v]) => v !== undefined && v !== null)),
      count: given.count ?? null,
    };
  }
}
