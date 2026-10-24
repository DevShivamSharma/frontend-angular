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

import type { PlanStall } from '../../domain/plan.models';
import { dialogData, DialogRef } from '../../../../core/dialog/app-dialog.service';
import { IconComponent } from '../../../../shared/ui/icon/icon.component';
import type { FillRegion } from '../auto-booths-dialog/auto-booths-dialog.component';
import { ringBox } from '../../domain/planner-geometry';
import {
  boothsOf,
  defaultBrief,
  Numbering,
  PlanBrief,
  PlanOption,
  planOptions,
  planSetting,
} from '../../domain/planner-plan';
import type { PlannerStore } from '../../state/planner.store';

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
  templateUrl: './plan-hall-dialog.component.html',
  styleUrl: './plan-hall-dialog.component.scss',
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
        pillarClearance: 1,
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
