import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { IconComponent } from '../../../shared/icon.component';
import { firstValueFrom } from 'rxjs';

import type {
  FloorArea,
  HallDetailView,
  HallFloor,
  HallView,
  VenueView,
} from '../../../core/api/api.models';
import { OrgContextStore } from '../../../core/org/org.stores';
import { RulesApi } from '../../../core/rules/rules-api.service';
import type {
  EventType,
  PlanStall,
  RuleCatalogue,
  RuleCheck,
  RuleId,
  RuleOverride,
  StallSide,
  Violation,
} from '../../../core/rules/rules.models';
import type { MultiPolygon } from '../../../core/venues/floor-plan.models';
import { VenuesApi } from '../../../core/venues/venues-api.service';
import { AREA_COLORS } from '../../../shared/floor/floor-view.component';
import { FieldComponent } from '../../../shared/field.component';
import { InputTextModule } from 'primeng/inputtext';
import { InputGroupModule } from 'primeng/inputgroup';
import { InputGroupAddonModule } from 'primeng/inputgroupaddon';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';

const SIDES: StallSide[] = ['top', 'bottom', 'left', 'right'];

/**
 * Tries the rules on a real hall before any layout exists: place stalls on the floor, and see
 * at once which rules they break, where, and why. Nothing is saved.
 */
@Component({
  selector: 'app-rules-try',
  imports: [
    DecimalPipe,
    FormsModule,
    ButtonModule,
    IconComponent,
    FieldComponent,
    InputTextModule,
    InputGroupModule,
    InputGroupAddonModule,
    SelectModule,
    SelectButtonModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pickers">
      <app-field label="Venue" for="try-venue">
        <p-select
          inputId="try-venue"
          [options]="venues()"
          optionLabel="name"
          optionValue="id"
          [ngModel]="venueId()"
          (ngModelChange)="pickVenue($event)"
        />
      </app-field>
      <app-field label="Hall" for="try-hall">
        <p-select
          inputId="try-hall"
          [options]="halls()"
          optionLabel="name"
          optionValue="id"
          [filter]="halls().length > 8"
          filterBy="name"
          [ngModel]="hallId()"
          (ngModelChange)="pickHall($event)"
          [disabled]="!halls().length"
        />
      </app-field>
      <app-field label="Event" for="try-event" class="narrow">
        <p-select
          inputId="try-event"
          [options]="eventTypes"
          [ngModel]="eventType()"
          (ngModelChange)="eventType.set($event); run()"
        />
      </app-field>
    </div>

    @if (!venues().length) {
      <p class="muted">Add a venue and a hall first; the rules are tried on a hall's real floor.</p>
    }

    @if (floor(); as f) {
      <div class="layout">
        <section class="panel stage">
          <div class="row bar">
            <span class="muted small"
              >Click the floor to place a {{ size().w }} × {{ size().d }} m stall; click a stall to
              change it.</span
            >
            <span class="spacer"></span>
            <button pButton [text]="true" (click)="clear()" [disabled]="!stalls().length">
              <app-icon name="delete_sweep" />Clear
            </button>
          </div>
          <svg
            #svg
            [attr.viewBox]="viewBox()"
            preserveAspectRatio="xMidYMid meet"
            (click)="place($event, svg)"
            role="img"
            [attr.aria-label]="'Floor of ' + (hall()?.name ?? 'the hall') + ' with trial stalls'"
          >
            <defs>
              <pattern id="try-grid" width="1" height="1" patternUnits="userSpaceOnUse">
                <path d="M 1 0 L 0 0 0 1" fill="none" class="grid-line" />
              </pattern>
            </defs>
            <rect
              [attr.x]="-2"
              [attr.y]="-2"
              [attr.width]="f.width + 4"
              [attr.height]="f.depth + 4"
              class="ground"
            />
            @if (f.geometry; as g) {
              <path [attr.d]="path(g.boundary)" class="floor" fill-rule="evenodd" />
              <path [attr.d]="path(g.boundary)" fill="url(#try-grid)" fill-rule="evenodd" />
              @for (z of g.zones; track z.id) {
                <path [attr.d]="path(z.geometry)" class="foyer" fill-rule="evenodd">
                  <title>{{ z.name }}</title>
                </path>
              }
              @for (o of g.objects; track o.id) {
                <path
                  [attr.d]="path(o.geometry)"
                  [attr.fill]="o.color || areaColor(o.kind)"
                  class="object"
                  fill-rule="evenodd"
                >
                  <title>{{ o.label || o.kind }}</title>
                </path>
              }
            } @else {
              <rect [attr.width]="f.width" [attr.height]="f.depth" class="floor" />
              <rect [attr.width]="f.width" [attr.height]="f.depth" fill="url(#try-grid)" />
              @for (a of f.areas; track $index) {
                <rect
                  [attr.x]="a.x"
                  [attr.y]="a.y"
                  [attr.width]="a.width"
                  [attr.height]="a.height"
                  [attr.fill]="areaFill(a)"
                  [attr.fill-opacity]="a.kind === 'outside' || a.kind === 'wall' ? 1 : 0.55"
                  class="object"
                >
                  <title>{{ a.label || a.kind }}</title>
                </rect>
              }
            }
            @for (v of shownViolations(); track $index) {
              @for (r of v.areas; track $index) {
                <rect
                  [attr.x]="r.x"
                  [attr.y]="r.y"
                  [attr.width]="r.width"
                  [attr.height]="r.height"
                  class="violation"
                  [class.aside]="v.overridden"
                />
              }
            }
            @for (s of stalls(); track s.id) {
              <g
                (click)="select(s.id, $event)"
                class="stall"
                [class.selected]="s.id === selectedId()"
                [class.bad]="bad().has(s.id)"
              >
                <rect
                  [attr.x]="s.x"
                  [attr.y]="s.y"
                  [attr.width]="s.width"
                  [attr.height]="s.depth"
                />
                @for (side of s.openSides; track side) {
                  <line
                    [attr.x1]="edge(s, side)[0]"
                    [attr.y1]="edge(s, side)[1]"
                    [attr.x2]="edge(s, side)[2]"
                    [attr.y2]="edge(s, side)[3]"
                    class="open"
                  />
                }
                <text [attr.x]="s.x + s.width / 2" [attr.y]="s.y + s.depth / 2">
                  {{ s.number }}
                </text>
              </g>
            }
          </svg>
          <p class="muted small key">
            <span class="k stall-k"></span> stall (open side drawn white)
            <span class="k bad-k"></span> breaks a rule <span class="k aside-k"></span> set aside
            with a reason
          </p>
        </section>

        <aside class="side">
          <section class="panel">
            <h3 class="section-title">New stalls</h3>
            <div class="pair">
              <app-field label="Width" for="try-width-1">
                <p-inputgroup>
                  <input
                    id="try-width-1"
                    pInputText
                    type="number"
                    min="1"
                    step="1"
                    [ngModel]="size().w"
                    (ngModelChange)="setSize('w', $event)"
                  />
                  <p-inputgroup-addon>m</p-inputgroup-addon>
                </p-inputgroup>
              </app-field>
              <app-field label="Depth" for="try-depth-2">
                <p-inputgroup>
                  <input
                    id="try-depth-2"
                    pInputText
                    type="number"
                    min="1"
                    step="1"
                    [ngModel]="size().d"
                    (ngModelChange)="setSize('d', $event)"
                  />
                  <p-inputgroup-addon>m</p-inputgroup-addon>
                </p-inputgroup>
              </app-field>
            </div>
          </section>

          @if (selected(); as s) {
            <section class="panel">
              <div class="row">
                <h3 class="section-title grow">Stall {{ s.number }}</h3>
                <button
                  pButton
                  [text]="true"
                  [rounded]="true"
                  severity="secondary"
                  (click)="removeSelected()"
                  aria-label="Remove this stall"
                >
                  <app-icon name="delete" />
                </button>
              </div>
              <div class="pair">
                <app-field label="x" for="try-x-3">
                  <p-inputgroup>
                    <input
                      id="try-x-3"
                      pInputText
                      type="number"
                      step="0.5"
                      [ngModel]="s.x"
                      (ngModelChange)="edit('x', $event)"
                    />
                    <p-inputgroup-addon>m</p-inputgroup-addon>
                  </p-inputgroup>
                </app-field>
                <app-field label="y" for="try-y-4">
                  <p-inputgroup>
                    <input
                      id="try-y-4"
                      pInputText
                      type="number"
                      step="0.5"
                      [ngModel]="s.y"
                      (ngModelChange)="edit('y', $event)"
                    />
                    <p-inputgroup-addon>m</p-inputgroup-addon>
                  </p-inputgroup>
                </app-field>
                <app-field label="Width" for="try-width-5">
                  <p-inputgroup>
                    <input
                      id="try-width-5"
                      pInputText
                      type="number"
                      step="0.5"
                      min="0.5"
                      [ngModel]="s.width"
                      (ngModelChange)="edit('width', $event)"
                    />
                    <p-inputgroup-addon>m</p-inputgroup-addon>
                  </p-inputgroup>
                </app-field>
                <app-field label="Depth" for="try-depth-6">
                  <p-inputgroup>
                    <input
                      id="try-depth-6"
                      pInputText
                      type="number"
                      step="0.5"
                      min="0.5"
                      [ngModel]="s.depth"
                      (ngModelChange)="edit('depth', $event)"
                    />
                    <p-inputgroup-addon>m</p-inputgroup-addon>
                  </p-inputgroup>
                </app-field>
              </div>
              <span id="try-open-sides" class="muted small">Open sides</span>
              <p-selectbutton
                [options]="sides"
                [multiple]="true"
                [ngModel]="s.openSides"
                (ngModelChange)="setSides($event)"
                ariaLabelledBy="try-open-sides"
              />
            </section>
          }

          <section class="panel">
            <div class="row">
              <h3 class="section-title grow">Result</h3>
              @if (result(); as r) {
                <span
                  class="status-chip"
                  [class.is-positive]="r.passed"
                  [class.is-warning]="!r.passed"
                >
                  {{ r.passed ? 'Passes' : open() + ' to fix' }}
                </span>
              }
            </div>
            @if (result(); as r) {
              <p class="muted small">
                {{ stalls().length }} stalls · {{ r.utilisation * 100 | number: '1.0-0' }}% of the
                stall floor
              </p>
              <ul class="violations">
                @for (v of r.violations; track $index) {
                  <li [class.aside]="v.overridden">
                    <span class="ref">{{ ruleLabel(v.ruleId) }} · {{ v.reference }}</span>
                    <span>{{ v.message }}</span>
                    @if (v.overridden; as o) {
                      <span class="small muted">Set aside: {{ o.reason }}</span>
                      <button pButton [text]="true" (click)="unsetAside(v)">Undo</button>
                    } @else if (!isProfile(v)) {
                      @if (asideFor() === v) {
                        <div class="aside-form">
                          <app-field
                            class="inline-field reason"
                            label="Reason (shown in approval)"
                            for="try-aside-reason"
                          >
                            <input
                              id="try-aside-reason"
                              pInputText
                              [(ngModel)]="reason"
                              maxlength="500"
                            />
                          </app-field>
                          <button
                            pButton
                            (click)="setAside(v)"
                            [disabled]="reason.trim().length < 3"
                          >
                            Set aside
                          </button>
                        </div>
                      } @else {
                        <button pButton [text]="true" (click)="asideFor.set(v); reason = ''">
                          Set aside…
                        </button>
                      }
                    }
                  </li>
                } @empty {
                  <li class="muted">No rule is broken.</li>
                }
              </ul>
              @if (offRules().length) {
                <p class="small muted">Not checked: {{ offRules().join(', ') }}.</p>
              }
            } @else {
              <p class="muted small">Place stalls to check them.</p>
            }
          </section>
        </aside>
      </div>
    }
  `,
  styles: `
    .pickers {
      display: flex;
      flex-wrap: wrap;
      gap: 0 12px;
    }
    .pickers app-field {
      flex: 1 1 200px;
    }
    .pickers .narrow {
      flex: 0 1 120px;
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 340px;
      gap: 16px;
      align-items: start;
    }
    .stage svg {
      display: block;
      width: 100%;
      height: auto;
      max-height: 72vh;
      cursor: crosshair;
    }
    .bar {
      margin-bottom: 8px;
    }
    .small {
      font: var(--app-body-small);
    }
    .grow {
      flex: 1 1 auto;
      margin: 0;
    }
    .ground {
      fill: var(--app-surface-container);
    }
    .floor {
      fill: var(--app-surface-container-lowest);
      stroke: var(--app-outline);
      stroke-width: 0.1;
    }
    .grid-line {
      stroke: var(--app-outline-variant);
      stroke-width: 0.03;
    }
    .foyer {
      fill: var(--app-tertiary-container);
      fill-opacity: 0.6;
    }
    .object {
      fill-opacity: 0.6;
      stroke: rgb(0 0 0 / 0.25);
      stroke-width: 0.05;
    }
    .violation {
      fill: #e53935;
      fill-opacity: 0.35;
      stroke: #b71c1c;
      stroke-width: 0.08;
      pointer-events: none;
    }
    .violation.aside {
      fill: #f9a825;
      stroke: #f57f17;
    }
    .stall rect {
      fill: #1e63c4;
      fill-opacity: 0.8;
      stroke: #0d3a78;
      stroke-width: 0.08;
      cursor: pointer;
    }
    .stall.bad rect {
      fill: #c62828;
    }
    .stall.selected rect {
      stroke: #ffb300;
      stroke-width: 0.2;
    }
    .stall .open {
      stroke: #fff;
      stroke-width: 0.25;
      pointer-events: none;
    }
    .stall text {
      font-size: 0.9px;
      fill: #fff;
      text-anchor: middle;
      dominant-baseline: middle;
      pointer-events: none;
    }
    .key {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
      margin: 8px 0 0;
    }
    .k {
      display: inline-block;
      width: 12px;
      height: 12px;
      border-radius: 3px;
      margin-left: 8px;
    }
    .stall-k {
      background: #1e63c4;
    }
    .bad-k {
      background: #e53935;
    }
    .aside-k {
      background: #f9a825;
    }
    .side {
      display: grid;
      gap: 16px;
    }
    .side .panel {
      padding: 16px;
    }
    .section-title {
      margin: 0 0 8px;
    }
    .pair {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0 10px;
    }
    .violations {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 10px;
    }
    .violations li {
      display: grid;
      gap: 2px;
      padding: 8px 10px;
      border-radius: 10px;
      background: var(--app-error-container);
      color: var(--app-on-error-container);
    }
    .violations li.aside {
      background: var(--app-surface-container-high);
      color: inherit;
    }
    .violations li.muted {
      background: none;
      padding: 0;
    }
    .ref {
      font: var(--app-label-small);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .aside-form {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .reason {
      flex: 1 1 160px;
    }
    @media (max-width: 1100px) {
      .layout {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `,
})
export class RulesTryComponent {
  readonly catalogue = input.required<RuleCatalogue | null>();

  private readonly rules = inject(RulesApi);
  private readonly venuesApi = inject(VenuesApi);
  private readonly context = inject(OrgContextStore);

  protected readonly sides = SIDES;
  protected readonly eventTypes: EventType[] = ['B2B', 'B2C'];
  protected readonly venues = signal<VenueView[]>([]);
  protected readonly halls = signal<HallView[]>([]);
  protected readonly venueId = signal<string | null>(null);
  protected readonly hallId = signal<string | null>(null);
  protected readonly hall = signal<HallDetailView | null>(null);
  protected readonly eventType = signal<EventType>('B2B');
  protected readonly size = signal({ w: 3, d: 3 });
  protected readonly stalls = signal<PlanStall[]>([]);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly overrides = signal<RuleOverride[]>([]);
  protected readonly result = signal<RuleCheck | null>(null);
  protected readonly asideFor = signal<Violation | null>(null);
  protected reason = '';
  private counter = 0;
  private runToken = 0;

  protected readonly floor = computed<HallFloor | null>(() => this.hall()?.floor ?? null);
  protected readonly selected = computed(
    () => this.stalls().find((s) => s.id === this.selectedId()) ?? null,
  );
  protected readonly shownViolations = computed(() => this.result()?.violations ?? []);
  protected readonly bad = computed(
    () =>
      new Set(
        (this.result()?.violations ?? []).filter((v) => !v.overridden).flatMap((v) => v.stallIds),
      ),
  );
  protected readonly open = computed(
    () => (this.result()?.violations ?? []).filter((v) => !v.overridden).length,
  );
  protected readonly offRules = computed(() => {
    const labels = new Map((this.catalogue()?.rules ?? []).map((r) => [r.id, r.label]));
    return (this.result()?.rules ?? [])
      .filter((r) => r.state !== 'checked')
      .map((r) => labels.get(r.id) ?? r.id);
  });
  protected readonly viewBox = computed(() => {
    const f = this.floor();
    return f ? `-2 -2 ${f.width + 4} ${f.depth + 4}` : '0 0 1 1';
  });

  constructor() {
    void this.loadVenues();
  }

  private async loadVenues(): Promise<void> {
    try {
      const venues = await firstValueFrom(this.venuesApi.venues(this.context.slug()));
      this.venues.set(venues);
      if (venues.length) await this.pickVenue(venues[0].id);
    } catch {
      // The error interceptor has shown it.
    }
  }

  protected async pickVenue(id: string): Promise<void> {
    this.venueId.set(id);
    this.hallId.set(null);
    this.hall.set(null);
    try {
      const halls = await firstValueFrom(this.venuesApi.halls(this.context.slug(), id));
      this.halls.set(halls);
      if (halls.length) await this.pickHall(halls[0].id);
    } catch {
      // The error interceptor has shown it.
    }
  }

  protected async pickHall(id: string): Promise<void> {
    this.hallId.set(id);
    this.clear();
    try {
      this.hall.set(await firstValueFrom(this.venuesApi.hall(this.context.slug(), id)));
    } catch {
      // The error interceptor has shown it.
    }
  }

  protected setSize(which: 'w' | 'd', raw: number | string): void {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) this.size.update((s) => ({ ...s, [which]: n }));
  }

  /** A click on the floor places a stall, its corner on the nearest whole metre. */
  protected place(event: MouseEvent, element: Element): void {
    const m = (element as SVGSVGElement).getScreenCTM();
    if (!m) return;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(m.inverse());
    const { w, d } = this.size();
    const id = `s${++this.counter}`;
    this.stalls.update((list) => [
      ...list,
      {
        id,
        number: String(this.counter),
        x: Math.floor(p.x),
        y: Math.floor(p.y),
        width: w,
        depth: d,
        openSides: ['bottom'],
      },
    ]);
    this.selectedId.set(id);
    this.run();
  }

  protected select(id: string, event: MouseEvent): void {
    event.stopPropagation();
    this.selectedId.set(id);
  }

  protected edit(field: 'x' | 'y' | 'width' | 'depth', raw: number | string): void {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    this.stalls.update((list) =>
      list.map((s) => (s.id === this.selectedId() ? { ...s, [field]: n } : s)),
    );
    this.run();
  }

  protected setSides(sides: StallSide[]): void {
    this.stalls.update((list) =>
      list.map((s) => (s.id === this.selectedId() ? { ...s, openSides: sides } : s)),
    );
    this.run();
  }

  protected removeSelected(): void {
    const id = this.selectedId();
    this.stalls.update((list) => list.filter((s) => s.id !== id));
    this.overrides.update((list) => list.filter((o) => !o.stallIds?.includes(id ?? '')));
    this.selectedId.set(null);
    this.run();
  }

  protected clear(): void {
    this.stalls.set([]);
    this.overrides.set([]);
    this.selectedId.set(null);
    this.result.set(null);
  }

  protected setAside(v: Violation): void {
    this.overrides.update((list) => [
      ...list,
      {
        ruleId: v.ruleId as RuleId,
        stallIds: v.stallIds.length ? v.stallIds : null,
        reason: this.reason.trim(),
      },
    ]);
    this.asideFor.set(null);
    this.run();
  }

  protected unsetAside(v: Violation): void {
    this.overrides.update((list) =>
      list.filter(
        (o) => !(o.ruleId === v.ruleId && (o.stallIds ?? []).join() === v.stallIds.join()),
      ),
    );
    this.run();
  }

  /** Checks the stalls with the server, the authority on the rules. The latest answer wins. */
  protected run(): void {
    const hallId = this.hallId();
    if (!hallId || !this.stalls().length) {
      this.result.set(null);
      return;
    }
    const token = ++this.runToken;
    firstValueFrom(
      this.rules.check(this.context.slug(), {
        hallId,
        eventType: this.eventType(),
        stalls: this.stalls(),
        overrides: this.overrides(),
      }),
    ).then(
      (result) => {
        if (token === this.runToken) this.result.set(result);
      },
      // The error interceptor has shown it.
      () => undefined,
    );
  }

  protected ruleLabel(id: string): string {
    if (id.startsWith('profile.')) return 'Drawing profile';
    return this.catalogue()?.rules.find((r) => r.id === id)?.label ?? id;
  }

  protected isProfile(v: Violation): boolean {
    return v.ruleId.startsWith('profile.');
  }

  protected path(g: MultiPolygon): string {
    return g
      .flatMap((poly) => poly.map((ring) => `M ${ring.map(([x, y]) => `${x} ${y}`).join(' L ')} Z`))
      .join(' ');
  }

  protected areaColor(kind: string): string {
    return (AREA_COLORS as Record<string, string>)[kind] ?? '#9e9e9e';
  }

  protected areaFill(a: FloorArea): string {
    return a.kind === 'outside' ? AREA_COLORS.outside : (a.color ?? AREA_COLORS[a.kind]);
  }

  /** The line of an open side: x1, y1, x2, y2. */
  protected edge(s: PlanStall, side: StallSide): [number, number, number, number] {
    switch (side) {
      case 'top':
        return [s.x, s.y, s.x + s.width, s.y];
      case 'bottom':
        return [s.x, s.y + s.depth, s.x + s.width, s.y + s.depth];
      case 'left':
        return [s.x, s.y, s.x, s.y + s.depth];
      case 'right':
        return [s.x + s.width, s.y, s.x + s.width, s.y + s.depth];
    }
  }
}
