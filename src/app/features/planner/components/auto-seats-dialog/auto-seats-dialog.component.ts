import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';

import type { PlanSeat } from '../../domain/plan.models';
import { dialogData, DialogRef } from '../../../../core/dialog/app-dialog.service';
import { IconComponent } from '../../../../shared/ui/icon/icon.component';
import type { FillRegion } from '../auto-booths-dialog/auto-booths-dialog.component';
import {
  centre,
  fillSeats,
  Front,
  letters,
  newId,
  nextRow,
  overlaps,
  ringBox,
  stallRect,
  zoneAt,
} from '../../domain/planner-geometry';
import type { PlannerStore } from '../../state/planner.store';
import { rowOptions } from '../seats-dialog/seats-dialog.component';

export interface AutoSeatsData {
  store: PlannerStore;
  regions: FillRegion[];
  regionId: string;
}

/** Seats at most in one fill. */
const MOST = 5000;
/** Kept between new seats and stalls, walls and what blocks, metres. */
const CLEARANCE = 0.3;

/**
 * Fills a zone or the hall with rows of seats, with aisles, rows counted from the front. Seats
 * are kept clear of stalls, walls and blocked floor. Closes with the seats; the page adds those
 * that break no rule.
 */
@Component({
  selector: 'app-auto-seats-dialog',
  imports: [DecimalPipe, FormsModule, ButtonModule, InputNumberModule, SelectModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './auto-seats-dialog.component.html',
  styleUrl: './auto-seats-dialog.component.scss',
})
export class AutoSeatsDialogComponent {
  protected readonly data = dialogData<AutoSeatsData>();
  protected readonly ref = inject(DialogRef);
  private readonly store = this.data.store;
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('preview');

  protected readonly mostAllowed = MOST;
  protected readonly clearance = CLEARANCE;
  private readonly after = nextRow(this.store.plan().seats);
  protected readonly firstRows = rowOptions(this.after);
  protected readonly fronts: Array<{ label: string; value: Front }> = [
    { label: 'Top of the plan', value: 'top' },
    { label: 'Bottom of the plan', value: 'bottom' },
    { label: 'Left of the plan', value: 'left' },
    { label: 'Right of the plan', value: 'right' },
  ];
  protected readonly categories = computed(() =>
    this.store.categories().filter((c) => c.status === 'active'),
  );

  protected readonly regionId = signal(this.data.regionId);
  protected readonly width = signal(0.5);
  protected readonly depth = signal(0.5);
  protected readonly gap = signal(0.1);
  protected readonly rowGap = signal(0.9);
  protected readonly aisleEvery = signal(10);
  protected readonly aisleWidth = signal(1.2);
  protected readonly front = signal<Front>('top');
  protected readonly firstRow = signal(this.after);
  protected readonly most = signal(MOST);
  protected readonly categoryId = signal<string | null>(null);

  protected readonly region = computed(
    () => this.data.regions.find((r) => r.id === this.regionId()) ?? this.data.regions[0],
  );

  protected readonly seats = computed(() => {
    const floor = this.store.floor();
    if (!floor) return [];
    const plan = this.store.plan();
    return fillSeats(
      {
        region: this.region().ring,
        width: this.width(),
        depth: this.depth(),
        gap: this.gap(),
        rowGap: this.rowGap(),
        aisleEvery: this.aisleEvery(),
        aisleWidth: this.aisleWidth(),
        front: this.front(),
        most: Math.min(this.most(), MOST),
        clearance: CLEARANCE,
      },
      floor,
      plan.stalls,
      plan.seats,
    );
  });
  protected readonly rowCount = computed(() => new Set(this.seats().map((s) => s.row)).size);
  protected readonly firstLabel = computed(() => `${letters(this.firstRow())}-1`);
  protected readonly lastRow = computed(() => letters(this.firstRow() + this.rowCount() - 1));

  constructor() {
    effect(() => this.draw());
  }

  /** The region, what blocks it, stalls and seats there, and the new seats. */
  private draw(): void {
    const canvas = this.canvas().nativeElement;
    const seats = this.seats();
    const ring = this.region().ring;
    const box = ringBox(ring);
    const ctx = canvas.getContext('2d');
    if (!ctx || !box.width || !box.height) return;
    const pad = 8;
    const scale = Math.min(
      (canvas.width - 2 * pad) / box.width,
      (canvas.height - 2 * pad) / box.height,
    );
    const ox = (canvas.width - box.width * scale) / 2 - box.x * scale;
    const oy = (canvas.height - box.height * scale) / 2 - box.y * scale;
    const rect = (r: { x: number; y: number; width: number; height: number }) =>
      ctx.fillRect(
        ox + r.x * scale,
        oy + r.y * scale,
        Math.max(1, r.width * scale),
        Math.max(1, r.height * scale),
      );
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Only the region: what lies past it is not this fill's business.
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox + box.x * scale, oy + box.y * scale, box.width * scale, box.height * scale);
    ctx.clip();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#94a3b8';
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ring.forEach(([x, y], i) =>
      i ? ctx.lineTo(ox + x * scale, oy + y * scale) : ctx.moveTo(ox + x * scale, oy + y * scale),
    );
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    const floor = this.store.floor();
    ctx.fillStyle = '#cbd5e1';
    for (const b of [...(floor?.blocked ?? []), ...(floor?.pillars ?? [])])
      if (overlaps(b, box)) rect(b);
    const plan = this.store.plan();
    ctx.fillStyle = '#86efac';
    for (const s of plan.stalls) rect(stallRect(s));
    ctx.fillStyle = '#d8b4fe';
    for (const s of plan.seats) rect(stallRect(s));
    ctx.fillStyle = '#7c3aed';
    for (const s of seats) rect(s);
    ctx.restore();
  }

  protected add(): void {
    const zones = this.store.plan().zones;
    const result: PlanSeat[] = this.seats().map((r) => ({
      id: newId(),
      zoneId: zoneAt(centre(r), zones)?.id ?? null,
      rowLabel: letters(this.firstRow() + r.row),
      seatNumber: r.seat,
      x: r.x,
      y: r.y,
      width: r.width,
      depth: r.height,
      categoryId: this.categoryId(),
    }));
    this.ref.close(result);
  }
}
