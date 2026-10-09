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
} from '../../../core/plans/plans.models';
import { IconComponent } from '../../../shared/icon.component';
import { pointInRing, polygonArea, ringBox } from './planner-geometry';
import type { PlannerStore } from './planner.store';

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
  template: `
    @let ro = readonly();
    <!-- Made again after a refused change, so every field shows the plan as it is. -->
    @for (key of [store().refused()]; track key) {
      @if (zone(); as z) {
        <h3>Zone</h3>
        <label
          >Name
          <input
            pInputText
            [ngModel]="z.name"
            (change)="zoneName(z, $event)"
            maxlength="80"
            [disabled]="ro"
          />
        </label>
        <label class="inline"
          >Colour
          <input type="color" [ngModel]="z.color" (change)="zoneColor(z, $event)" [disabled]="ro" />
        </label>
        <dl>
          <dt>Length × breadth</dt>
          <dd>
            {{ zoneBox().width | number: '1.0-2' }} × {{ zoneBox().height | number: '1.0-2' }} m
          </dd>
          <dt>Area</dt>
          <dd>{{ zoneArea() | number: '1.0-2' }} m²</dd>
          <dt>Corners</dt>
          <dd>{{ z.polygon.length }}</dd>
          <dt>Stalls in it</dt>
          <dd>{{ zoneStalls() }}</dd>
          <dt>Seats in it</dt>
          <dd>{{ zoneSeats() }}</dd>
        </dl>
        @if (!ro) {
          <button pButton severity="danger" [outlined]="true" (click)="remove.emit()">
            <app-icon name="delete" />Delete zone
          </button>
          <p class="muted small">Stalls and seats in the zone stay where they are.</p>
        }
      } @else if (stalls().length === 1) {
        @let s = stalls()[0];
        <h3>Stall {{ label(s) }}</h3>
        <div class="pair">
          <label
            >Island / prefix
            <input
              pInputText
              [ngModel]="s.islandNumber ?? ''"
              (change)="text('islandNumber', $event, true)"
              maxlength="40"
              [disabled]="ro"
            />
          </label>
          <label
            >Number
            <input
              pInputText
              [ngModel]="s.stallNumber"
              (change)="text('stallNumber', $event, false)"
              maxlength="20"
              [disabled]="ro"
            />
          </label>
          <label
            >X (m)
            <p-inputnumber
              [ngModel]="s.x"
              (onBlur)="num('x', $event, s.x)"
              [maxFractionDigits]="3"
              [disabled]="ro"
            />
          </label>
          <label
            >Y (m)
            <p-inputnumber
              [ngModel]="s.y"
              (onBlur)="num('y', $event, s.y)"
              [maxFractionDigits]="3"
              [disabled]="ro"
            />
          </label>
          <label
            >Width (m)
            <p-inputnumber
              [ngModel]="s.width"
              (onBlur)="num('width', $event, s.width)"
              [min]="0.1"
              [maxFractionDigits]="3"
              [disabled]="ro"
            />
          </label>
          <label
            >Depth (m)
            <p-inputnumber
              [ngModel]="s.depth"
              (onBlur)="num('depth', $event, s.depth)"
              [min]="0.1"
              [maxFractionDigits]="3"
              [disabled]="ro"
            />
          </label>
        </div>
        <p class="muted small nums">{{ s.width * s.depth | number: '1.0-2' }} m²</p>
        <span class="lbl">Open sides</span>
        <div class="sides" role="group" aria-label="Open sides">
          @for (side of sideList; track side) {
            <button
              type="button"
              class="side"
              [class.on]="s.openSides.includes(side)"
              [attr.aria-pressed]="s.openSides.includes(side)"
              (click)="toggleSide(s, side)"
              [disabled]="ro"
            >
              {{ side }}
            </button>
          }
        </div>
        <label
          >Scheme
          <p-select
            [options]="schemes"
            optionLabel="label"
            optionValue="value"
            [ngModel]="s.scheme"
            (ngModelChange)="patch.emit({ scheme: $event })"
            [disabled]="ro"
            appendTo="body"
          />
        </label>
        <label data-tour="stall-categories"
          >Categories
          <p-multiselect
            [options]="categoryOptions(s.categoryIds)"
            optionLabel="name"
            optionValue="id"
            [ngModel]="s.categoryIds"
            (ngModelChange)="patch.emit({ categoryIds: $event })"
            placeholder="None"
            display="chip"
            [disabled]="ro"
            appendTo="body"
          />
        </label>
        @if (!store().categories().length) {
          <p class="muted small">
            This hall sells no categories yet; the venue chooses them on the hall page.
          </p>
        }
        <fieldset class="flags">
          <legend class="lbl">Flags</legend>
          @for (f of flags; track f.key) {
            <label class="check">
              <p-checkbox
                [binary]="true"
                [ngModel]="s[f.key]"
                (ngModelChange)="flag(f.key, $event)"
                [disabled]="ro"
              />
              {{ f.label }}
            </label>
          }
        </fieldset>
        <label
          >Location
          <input
            pInputText
            [ngModel]="s.location ?? ''"
            (change)="text('location', $event, true)"
            maxlength="200"
            placeholder="e.g. Between Hall 5 and 6"
            [disabled]="ro"
          />
        </label>
        <label
          >Description
          <textarea
            pTextarea
            rows="2"
            [ngModel]="s.description ?? ''"
            (change)="text('description', $event, true)"
            maxlength="500"
            [disabled]="ro"
          ></textarea>
        </label>
        @if (!ro) {
          <button pButton severity="danger" [outlined]="true" (click)="remove.emit()">
            <app-icon name="delete" />Delete stall
          </button>
        }
      } @else if (stalls().length > 1) {
        <h3>{{ stalls().length }} stalls</h3>
        <dl>
          <dt>Area</dt>
          <dd>{{ stallsArea() | number: '1.0-1' }} m²</dd>
        </dl>
        <label
          >Categories of all
          <p-multiselect
            [options]="categoryOptions([])"
            optionLabel="name"
            optionValue="id"
            [ngModel]="sharedCategories()"
            (ngModelChange)="patch.emit({ categoryIds: $event })"
            placeholder="Mixed"
            display="chip"
            [disabled]="ro"
            appendTo="body"
          />
        </label>
        @if (!ro) {
          <button pButton severity="danger" [outlined]="true" (click)="remove.emit()">
            <app-icon name="delete" />Delete {{ stalls().length }} stalls
          </button>
        }
      } @else if (seats().length) {
        <h3>
          {{
            seats().length === 1
              ? 'Seat ' + seats()[0].rowLabel + '-' + seats()[0].seatNumber
              : seats().length + ' seats'
          }}
        </h3>
        <dl>
          <dt>Rows</dt>
          <dd>{{ seatRows() }}</dd>
        </dl>
        <label
          >Category
          <p-select
            [options]="categoryOptions([])"
            optionLabel="name"
            optionValue="id"
            [ngModel]="sharedSeatCategory()"
            (ngModelChange)="seatCategory.emit($event ?? null)"
            [showClear]="true"
            placeholder="None"
            [disabled]="ro"
            appendTo="body"
          />
        </label>
        <p class="muted small">Drag a selected seat to move them all.</p>
        @if (!ro) {
          <button pButton severity="danger" [outlined]="true" (click)="remove.emit()">
            <app-icon name="delete" />Delete
            {{ seats().length === 1 ? 'seat' : seats().length + ' seats' }}
          </button>
        }
      } @else if (objects().length) {
        @let o = objects()[0];
        <h3>
          {{ objects().length === 1 ? objectNames[o.kind] : objects().length + ' drawings' }}
        </h3>
        @if (objects().length === 1) {
          <label
            >{{ o.kind === 'text' ? 'Text' : 'Label' }}
            <input
              pInputText
              [ngModel]="o.text ?? ''"
              (change)="objectText(o, $event)"
              maxlength="120"
              [disabled]="ro"
            />
          </label>
        }
        <label class="inline"
          >Colour
          <input type="color" [ngModel]="o.color" (change)="objectColor($event)" [disabled]="ro" />
        </label>
        <p class="muted small">Drawings are not sold and the rules do not check them.</p>
        @if (!ro) {
          <button pButton severity="danger" [outlined]="true" (click)="remove.emit()">
            <app-icon name="delete" />Delete
            {{ objects().length === 1 ? 'drawing' : objects().length + ' drawings' }}
          </button>
        }
      } @else {
        <h3>Properties</h3>
        <p class="muted small">
          Select a zone, stall, seat or drawing to see and change it. Drag on the floor to select
          many.
        </p>
      }
    }
  `,
  styles: `
    :host {
      display: grid;
      gap: 10px;
      align-content: start;
    }
    h3 {
      margin: 0;
      font: var(--app-title-small);
    }
    label,
    .lbl {
      display: grid;
      gap: 4px;
      font: var(--app-label-medium);
    }
    .inline {
      grid-template-columns: 1fr auto;
      align-items: center;
    }
    input[type='color'] {
      width: 44px;
      height: 30px;
      padding: 0;
      border: 1px solid var(--app-outline-variant);
      border-radius: 6px;
      background: none;
    }
    .pair {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    :host ::ng-deep .p-inputnumber,
    :host ::ng-deep .p-inputnumber-input,
    :host ::ng-deep .p-select,
    :host ::ng-deep .p-multiselect,
    input[pInputText],
    textarea {
      width: 100%;
      min-width: 0;
    }
    .sides {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 4px;
    }
    .side {
      padding: 6px 0;
      border: 1px solid var(--app-outline-variant);
      border-radius: 6px;
      background: var(--app-surface);
      color: var(--app-on-surface);
      font: var(--app-label-small);
      text-transform: capitalize;
      cursor: pointer;
    }
    .side.on {
      background: #dcfce7;
      border-color: #16a34a;
      color: #14532d;
    }
    .flags {
      display: grid;
      gap: 6px;
      margin: 0;
      padding: 0;
      border: 0;
    }
    .check {
      display: flex;
      gap: 8px;
      align-items: center;
      font: var(--app-body-medium);
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
      font-variant-numeric: tabular-nums;
    }
    .small {
      font: var(--app-body-small);
      margin: 0;
    }
    .nums {
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class PlannerPropertiesComponent {
  readonly store = input.required<PlannerStore>();
  readonly readonly = input(false);

  /** Changes to the selected stalls. */
  readonly patch = output<StallPatch>();
  readonly zonePatch = output<Partial<Omit<PlanZone, 'id'>>>();
  readonly seatCategory = output<string | null>();
  /** Changes to the selected drawings. */
  readonly objectPatch = output<Partial<Pick<PlanObject, 'text' | 'color'>>>();
  readonly remove = output<void>();

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
    this.stalls().reduce((sum, s) => sum + s.width * s.depth, 0),
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
