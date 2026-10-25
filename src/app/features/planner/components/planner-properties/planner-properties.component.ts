import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { MultiSelectModule } from 'primeng/multiselect';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';

import {
  PlanObject,
  PlanObjectKind,
  PlanSeat,
  PlanStall,
  PlanZone,
  STALL_SIDES,
  stallLabel,
  StallSide,
} from '../../domain/plan.models';
import { IconComponent } from '../../../../shared/ui/icon/icon.component';
import { pointInRing, polygonArea, ringBox } from '../../domain/planner-geometry';
import type { PlannerStore } from '../../state/planner.store';
import { stallArea } from '../../domain/stall-cells';
import { rupees, type StallPrice } from '../../domain/stall-price';

export type StallPatch = Partial<Omit<PlanStall, 'id'>>;

/** The flags ITPO keeps on a stall, in the order its booking team reads them. */
const FLAGS: Array<{ key: keyof PlanStall; label: string }> = [
  { key: 'isPremium', label: 'Premium' },
  { key: 'isBlocked', label: 'Blocked (not for sale)' },
  { key: 'isFnb', label: 'Food & beverage' },
  { key: 'isBranding', label: 'Branding' },
  { key: 'isHorseshoe', label: 'Horseshoe' },
  { key: 'isMarqueeAvailable', label: 'Marquee available' },
  { key: 'isRestrictedForOverseas', label: 'Not for overseas exhibitors' },
  { key: 'isActive', label: 'Active' },
];

/**
 * What is selected, and its details to change. Each change is reported to the page, which
 * makes it only when it breaks no rule; the fields show the plan as it then is.
 */
@Component({
  selector: 'app-planner-properties',
  imports: [
    DecimalPipe,
    FormsModule,
    ButtonModule,
    CheckboxModule,
    InputNumberModule,
    InputTextModule,
    MultiSelectModule,
    SelectModule,
    TextareaModule,
    IconComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './planner-properties.component.html',
  styleUrl: './planner-properties.component.scss',
})
export class PlannerPropertiesComponent {
  protected readonly rupees = rupees;

  /** The price the rate card gives the stall; null without a card or when it is not for sale. */
  protected priceOf(s: { id: string }): StallPrice | null {
    return this.store().prices().get(s.id) ?? null;
  }

  protected readonly stallArea = stallArea;
  readonly store = input.required<PlannerStore>();
  readonly readonly = input(false);

  /** Changes to the selected stalls. */
  readonly patch = output<StallPatch>();
  readonly zonePatch = output<Partial<Omit<PlanZone, 'id'>>>();
  readonly seatCategory = output<string | null>();
  /** Changes to the selected drawings. */
  readonly objectPatch = output<Partial<Pick<PlanObject, 'text' | 'color'>>>();
  readonly remove = output<void>();
  /** Moves the selected stalls, hall metres. */
  readonly nudge = output<{ dx: number; dy: number }>();

  protected readonly objectNames: Record<PlanObjectKind, string> = {
    line: 'Line',
    rect: 'Rectangle',
    circle: 'Circle',
    polyline: 'Polyline',
    text: 'Text',
  };

  protected readonly flags = FLAGS;
  protected readonly sideList = STALL_SIDES;
  protected readonly schemes = [
    { label: 'Shell', value: 'shell' },
    { label: 'Raw space', value: 'raw' },
  ];

  protected readonly zone = computed(() => this.store().selectedZone());
  protected readonly stalls = computed(() => this.store().selectedStalls());
  protected readonly seats = computed(() => this.store().selectedSeats());
  protected readonly objects = computed(() => this.store().selectedObjects());

  protected readonly zoneBox = computed(() => ringBox(this.zone()?.polygon ?? [[0, 0]]));
  protected readonly zoneArea = computed(() => polygonArea(this.zone()?.polygon ?? []));
  protected readonly zoneStalls = computed(() => this.inZone(this.store().plan().stalls));
  protected readonly zoneSeats = computed(() => this.inZone(this.store().plan().seats));
  protected readonly stallsArea = computed(() =>
    this.stalls().reduce((sum, s) => sum + stallArea(s), 0),
  );
  protected readonly sharedCategories = computed(() => {
    const [first, ...rest] = this.stalls();
    if (!first) return [];
    const key = (s: PlanStall) => [...s.categoryIds].sort().join();
    return rest.every((s) => key(s) === key(first)) ? first.categoryIds : [];
  });
  protected readonly seatRows = computed(() =>
    [...new Set(this.seats().map((s) => s.rowLabel))].join(', '),
  );
  protected readonly sharedSeatCategory = computed(() => {
    const ids = new Set(this.seats().map((s) => s.categoryId));
    return ids.size === 1 ? [...ids][0] : null;
  });

  protected label(s: PlanStall): string {
    return stallLabel(s);
  }

  /** The hall's active categories, and inactive ones the selection already has. */
  protected categoryOptions(have: string[]) {
    return this.store()
      .categories()
      .filter((c) => c.status === 'active' || have.includes(c.id))
      .map((c) => ({ ...c, name: c.status === 'active' ? c.name : `${c.name} (inactive)` }));
  }

  protected zoneName(z: PlanZone, event: Event): void {
    const name = (event.target as HTMLInputElement).value.trim();
    if (name && name !== z.name) this.zonePatch.emit({ name });
    else (event.target as HTMLInputElement).value = z.name;
  }

  protected zoneColor(z: PlanZone, event: Event): void {
    const color = (event.target as HTMLInputElement).value;
    if (color !== z.color) this.zonePatch.emit({ color });
  }

  /** Text must have some; a label of another drawing may be cleared. */
  protected objectText(o: PlanObject, event: Event): void {
    const el = event.target as HTMLInputElement;
    const text = el.value.trim();
    if (o.kind === 'text' && !text) {
      el.value = o.text ?? '';
      return;
    }
    if (text !== (o.text ?? '')) this.objectPatch.emit({ text: text || null });
  }

  protected objectColor(event: Event): void {
    this.objectPatch.emit({ color: (event.target as HTMLInputElement).value });
  }

  protected text(
    key: 'islandNumber' | 'stallNumber' | 'location' | 'description',
    event: Event,
    optional: boolean,
  ): void {
    const el = event.target as HTMLInputElement;
    const value = el.value.trim();
    if (!value && !optional) {
      el.value = this.stalls()[0]?.stallNumber ?? '';
      return;
    }
    this.patch.emit({
      [key]: key === 'islandNumber' ? el.value || null : value || (optional ? null : value),
    });
  }

  protected num(key: 'x' | 'y' | 'width' | 'depth', event: Event, current: number): void {
    const raw = (event.target as HTMLInputElement).value.replace(/,/g, '');
    const value = Number(raw);
    if (!raw || !Number.isFinite(value) || value === current) return;
    if ((key === 'width' || key === 'depth') && value <= 0) return;
    this.patch.emit({ [key]: value });
  }

  /** A price typed in a field: set on the stall (or on every selected stall) when it changes. */
  protected ownPrice(event: Event): void {
    const raw = (event.target as HTMLInputElement).value.replace(/,/g, '').trim();
    if (!raw) return;
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0) this.patch.emit({ price: value });
  }

  protected toggleSide(s: PlanStall, side: StallSide): void {
    const open = s.openSides.includes(side)
      ? s.openSides.filter((x) => x !== side)
      : STALL_SIDES.filter((x) => x === side || s.openSides.includes(x));
    this.patch.emit({ openSides: open });
  }

  protected flag(key: keyof PlanStall, value: boolean): void {
    this.patch.emit({ [key]: value });
  }

  private inZone(list: Array<PlanStall | PlanSeat>): number {
    const z = this.zone();
    return z
      ? list.filter(
          (i) =>
            i.zoneId === z.id || pointInRing([i.x + i.width / 2, i.y + i.depth / 2], z.polygon),
        ).length
      : 0;
  }
}
