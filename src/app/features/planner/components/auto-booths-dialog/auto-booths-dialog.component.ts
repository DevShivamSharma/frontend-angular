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

import type { PlanStall, StallScheme, StallSide } from '../../domain/plan.models';
import type { Point } from '../../domain/floor-plan.models';
import { dialogData, DialogRef } from '../../../../core/dialog/app-dialog.service';
import { IconComponent } from '../../../../shared/ui/icon/icon.component';
import {
  BoothPlace,
  centre,
  fillBooths,
  fillRows,
  keepClearOf,
  newId,
  overlaps,
  pointInRing,
  Rect,
  ringBox,
  stallRect,
  standArea,
  zoneAt,
} from '../../domain/planner-geometry';
import { Numbering, numberPlaces } from '../../domain/planner-plan';
import type { PlannerStore } from '../../state/planner.store';
import { stallArea } from '../../domain/stall-cells';

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

/** How booths are laid out: in rows as halls are cut, or each on its own with aisles round it. */
type Layout = 'rows' | 'single';
/** A cross-aisle at least this often, metres, whatever the booth size. */
const CROSS_AISLE_METRES = 30;
const CROSS_AISLE_BOOTHS = 10;
/** The plan's grid: rows start on it, and the margin is at least one square. */
const GRID = 1;

/** A place in the preview, with its id; `meta` when it came from a row layout. */
type Candidate = Rect & { id: string; meta?: BoothPlace };

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
  templateUrl: './auto-booths-dialog.component.html',
  styleUrl: './auto-booths-dialog.component.scss',
})
export class AutoBoothsDialogComponent {
  protected readonly data = dialogData<AutoBoothsData>();
  protected readonly ref = inject(DialogRef);
  private readonly store = this.data.store;

  protected readonly sizes = SIZES;
  protected readonly layouts = [
    { label: 'Rows back to back', value: 'rows' },
    { label: 'Each on its own', value: 'single' },
  ];
  protected readonly numberings: Array<{ label: string; value: Numbering }> = [
    { label: 'By line: A1, A2… B1…', value: 'line' },
    { label: 'By island: 1-A, 1-B… 2-A…', value: 'island' },
    { label: 'In order: 1, 2, 3…', value: 'numbers' },
    { label: 'In order: A, B, C…', value: 'letters' },
  ];
  protected readonly schemes = [
    { label: 'Shell', value: 'shell' },
    { label: 'Raw space', value: 'raw' },
  ];
  protected readonly categories = computed(() =>
    this.store.categories().filter((c) => c.status === 'active'),
  );

  /** A cross-aisle every ten booths, or every 30 m with big booths. */
  protected readonly autoCross = computed(() =>
    Math.max(1, Math.min(CROSS_AISLE_BOOTHS, Math.floor(CROSS_AISLE_METRES / this.width()))),
  );
  /** The hall's category for corner booths, when it sells one. */
  protected readonly cornerCategory = computed(
    () => this.categories().find((c) => /corner/i.test(c.name)) ?? null,
  );
  protected readonly regionId = signal(this.data.regionId);
  protected readonly size = signal('3x3');
  protected readonly width = signal(3);
  protected readonly depth = signal(3);
  private readonly rules = this.store.view()!.hall.rules;
  private readonly ruleOn = (id: string) =>
    (this.rules.switches as Record<string, boolean>)[id] !== false;
  /** What the hall's rules keep from the walls; 0 when that rule is off. */
  protected readonly wallRule = signal(
    this.ruleOn('peripheralClearance') ? this.rules.values.peripheralClearance : 0,
  );
  protected readonly layout = signal<Layout>('rows');
  protected readonly aisle = signal(this.data.passage);
  /** From the edge: what the rules keep from the walls, and at least one grid square. */
  protected readonly margin = signal(Math.max(GRID, this.wallRule()));
  /** Null: as often as {@link autoCross}. */
  protected readonly crossEvery = signal<number | null>(null);
  protected readonly corners = signal(true);
  protected readonly wallLines = signal(false);
  protected readonly numbering = signal<Numbering>('line');
  protected readonly count = signal<number | null>(null);
  /** The hall's Pillars rule: its clearance when on, else null. */
  protected readonly pillarRule = pillarRuleOf(this.data.store);
  protected readonly pillarClear = signal(Math.max(0.5, this.pillarRule ?? 0.5));
  protected readonly shift = signal(true);
  protected readonly sellPillar = signal(false);
  protected readonly prefix = signal('');
  protected readonly startAt = signal('');
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
  protected readonly candidates = computed<Candidate[]>(() => {
    const floor = this.store.floor();
    const view = this.store.view();
    if (!floor || !view) return [];
    const plan = this.store.plan();
    if (this.layout() === 'single') {
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
    }
    return fillRows(
      {
        region: this.region().ring,
        width: this.width(),
        depth: this.depth(),
        aisle: this.aisle(),
        margin: this.margin(),
        crossEvery: this.crossEvery() ?? this.autoCross(),
        count: this.count(),
        pillarClearance: this.pillarClear(),
        shiftForPillars: this.shift(),
        sellPillarStands: this.sellPillar(),
        corners: this.corners(),
        keepClear: keepClearOf(view.hall.floor, this.rules.values, this.ruleOn),
        cornerClear: this.ruleOn('cornerKeepOut') ? this.data.passage : 0,
        wallLines: this.wallLines(),
        grid: GRID,
      },
      floor,
      plan.stalls,
      plan.seats,
    ).map((meta) => ({
      x: meta.x,
      y: meta.y,
      width: meta.width,
      height: meta.height,
      id: newId(),
      meta,
    }));
  });

  protected readonly chosen = computed(() =>
    this.candidates().filter((c) => !this.excluded().has(c.id) && !this.bad().has(c.id)),
  );
  protected readonly cornerCount = computed(
    () => this.chosen().filter((c) => c.meta?.corner).length,
  );
  /** How much of the hall's stall floor the stalls would cover, against the rule's limit. */
  protected readonly utilisation = computed(() => {
    const floor = this.store.floor();
    if (!floor || !this.ruleOn('maxUtilization')) return null;
    const area = standArea(floor);
    if (!area) return null;
    const stalls = this.store.plan().stalls.reduce((sum, s) => sum + stallArea(s), 0);
    const added = this.chosen().reduce((sum, c) => sum + c.width * c.height, 0);
    const used = ((stalls + added) / area) * 100;
    const limit = Math.round(this.rules.values.maxUtilization * 100);
    return { used, limit, over: used > limit };
  });

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

  /** The places as booths, numbered and opened as the layout says. */
  private booths(places: Candidate[]): PlanStall[] {
    const zones = this.store.plan().zones;
    const numbers = this.numbersFor(places);
    // Each on its own: rows open towards each other in pairs, onto the aisle between them.
    const rows = [...new Set(places.map((r) => r.y))].sort((a, b) => a - b);
    const facing = (r: Candidate): StallSide[] =>
      r.meta?.openSides ?? (rows.indexOf(r.y) % 2 ? ['top'] : ['bottom']);
    const corner = this.corners() ? this.cornerCategory()?.id : undefined;
    return places.map((r, i) => {
      const categoryIds = [...this.categoryIds()];
      if (corner && r.meta?.corner && !categoryIds.includes(corner)) categoryIds.push(corner);
      return {
        id: r.id,
        zoneId: zoneAt(centre(r), zones)?.id ?? null,
        islandNumber: numbers[i].island,
        stallNumber: numbers[i].stall,
        x: r.x,
        y: r.y,
        width: r.width,
        depth: r.height,
        openSides: facing(r),
        cutCells: [],
        scheme: this.scheme(),
        categoryIds,
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
      };
    });
  }

  /** Island and stall number of each place, as the numbering chosen says. */
  private numbersFor(places: Candidate[]): Array<{ island: string | null; stall: string }> {
    return numberPlaces(
      places.map((p) => ({ ...p, line: p.meta?.line, island: p.meta?.island })),
      this.store.plan().stalls,
      this.numbering(),
      this.prefix(),
      this.startAt(),
    );
  }

  protected add(): void {
    this.ref.close(this.booths(this.chosen()));
  }
}

/** The clearance of the hall's Pillars rule when it is on; null when it is off. */
function pillarRuleOf(store: PlannerStore): number | null {
  const rules = store.view()?.hall.rules;
  if (!rules || (rules.switches as Record<string, boolean>)['PILLAR'] === false) return null;
  return rules.values.pillarClearance ?? 0;
}
