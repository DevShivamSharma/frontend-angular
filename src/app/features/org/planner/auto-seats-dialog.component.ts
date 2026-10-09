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

import type { PlanSeat } from '../../../core/plans/plans.models';
import { dialogData, DialogRef } from '../../../core/ui/app-dialog.service';
import { IconComponent } from '../../../shared/icon.component';
import type { FillRegion } from './auto-booths-dialog.component';
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
} from './planner-geometry';
import type { PlannerStore } from './planner.store';
import { rowOptions } from './seats-dialog.component';

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
  template: `
    <h2 class="dialog-title head">
      <app-icon name="auto_awesome" /> Auto-seats
      <small class="muted">— fill {{ region().name }} with seats</small>
    </h2>
    <div class="dialog-content stack">
      <div class="three">
        <label class="wide"
          >Fill
          <p-select
            [options]="data.regions"
            optionLabel="label"
            optionValue="id"
            [ngModel]="regionId()"
            (ngModelChange)="regionId.set($event)"
            appendTo="body"
          />
        </label>
        <label
          >Seat width (m)
          <p-inputnumber
            [ngModel]="width()"
            (ngModelChange)="width.set($event ?? 0.5)"
            [min]="0.2"
            [max]="5"
            [maxFractionDigits]="2"
          />
        </label>
        <label
          >Seat depth (m)
          <p-inputnumber
            [ngModel]="depth()"
            (ngModelChange)="depth.set($event ?? 0.5)"
            [min]="0.2"
            [max]="5"
            [maxFractionDigits]="2"
          />
        </label>
        <label
          >Gap between seats (m)
          <p-inputnumber
            [ngModel]="gap()"
            (ngModelChange)="gap.set($event ?? 0)"
            [min]="0"
            [max]="5"
            [maxFractionDigits]="2"
          />
        </label>
        <label
          >Gap between rows (m)
          <p-inputnumber
            [ngModel]="rowGap()"
            (ngModelChange)="rowGap.set($event ?? 0)"
            [min]="0"
            [max]="10"
            [maxFractionDigits]="2"
          />
        </label>
        <label
          >Aisle after every (seats, 0 = none)
          <p-inputnumber
            [ngModel]="aisleEvery()"
            (ngModelChange)="aisleEvery.set($event ?? 0)"
            [min]="0"
            [max]="500"
          />
        </label>
        <label
          >Aisle width (m)
          <p-inputnumber
            [ngModel]="aisleWidth()"
            (ngModelChange)="aisleWidth.set($event ?? 0)"
            [min]="0"
            [max]="20"
            [maxFractionDigits]="2"
          />
        </label>
        <label
          >Front (row A)
          <p-select
            [options]="fronts"
            optionLabel="label"
            optionValue="value"
            [ngModel]="front()"
            (ngModelChange)="front.set($event)"
            appendTo="body"
          />
        </label>
        <label
          >First row
          <p-select
            [options]="firstRows"
            optionLabel="label"
            optionValue="value"
            [ngModel]="firstRow()"
            (ngModelChange)="firstRow.set($event)"
            appendTo="body"
          />
        </label>
        <label
          >At most (seats)
          <p-inputnumber
            [ngModel]="most()"
            (ngModelChange)="most.set($event ?? 1)"
            [min]="1"
            [max]="mostAllowed"
          />
        </label>
        <label
          >Category
          <p-select
            [options]="categories()"
            optionLabel="name"
            optionValue="id"
            [ngModel]="categoryId()"
            (ngModelChange)="categoryId.set($event)"
            [showClear]="true"
            placeholder="None"
            appendTo="body"
          />
        </label>
      </div>
      <div class="preview">
        <canvas #preview width="760" height="300" aria-hidden="true"></canvas>
        <p>
          <b>{{ seats().length | number }}</b> seats in {{ rowCount() }} rows
          @if (seats().length) {
            , {{ firstLabel() }} to row {{ lastRow() }}
          }
          @if (seats().length >= mostAllowed) {
            (the most at once)
          }
          <br /><span class="muted"
            >Kept {{ clearance }} m from booths and walls; seats already placed stay as they
            are.</span
          >
        </p>
      </div>
    </div>
    <div class="dialog-actions">
      <button pButton [text]="true" type="button" (click)="ref.close()">Cancel</button>
      <button pButton type="button" class="seat-btn" (click)="add()" [disabled]="!seats().length">
        Add {{ seats().length | number }} seats
      </button>
    </div>
  `,
  styles: `
    .head {
      display: flex;
      gap: 8px;
      align-items: baseline;
    }
    .head small {
      font: var(--app-body-small);
    }
    .stack {
      display: grid;
      gap: 14px;
    }
    .three {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px 12px;
    }
    .wide {
      grid-column: 1 / -1;
    }
    @media (max-width: 640px) {
      .three {
        grid-template-columns: 1fr 1fr;
      }
    }
    label {
      display: grid;
      gap: 4px;
      font: var(--app-label-medium);
      align-content: end;
    }
    :host ::ng-deep .p-inputnumber,
    :host ::ng-deep .p-inputnumber-input,
    :host ::ng-deep .p-select {
      width: 100%;
    }
    .preview {
      display: grid;
      gap: 8px;
      padding: 12px;
      border: 1px solid var(--app-outline-variant);
      border-radius: 10px;
      background: var(--app-surface-container-low);
      text-align: center;
      font-size: 13px;
    }
    .preview p {
      margin: 0;
    }
    canvas {
      width: 100%;
      height: auto;
      max-height: 300px;
    }
    .seat-btn {
      --p-button-primary-background: #9333ea;
      --p-button-primary-border-color: #9333ea;
      --p-button-primary-hover-background: #7e22ce;
      --p-button-primary-hover-border-color: #7e22ce;
    }
  `,
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
