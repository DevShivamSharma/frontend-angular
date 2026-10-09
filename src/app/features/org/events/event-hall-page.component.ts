import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { IconComponent } from '../../../shared/icon.component';
import { ProgressBarModule } from 'primeng/progressbar';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { EventsApi } from '../../../core/events/events-api.service';
import type { EventHallDetailView } from '../../../core/events/events.models';
import { OrgContextStore } from '../../../core/org/org.stores';
import { RulesApi } from '../../../core/rules/rules-api.service';
import type {
  RuleCatalogue,
  RuleDefinition,
  RuleGroup,
  RuleId,
  RulesView,
} from '../../../core/rules/rules.models';
import { ConfirmService } from '../../../core/ui/confirm.service';
import { Notifier } from '../../../core/ui/notifier.service';
import { FloorViewComponent } from '../../../shared/floor/floor-view.component';
import { PageHeaderComponent } from '../../../shared/page-header.component';
import { RulesSummaryComponent } from '../rules/rules-summary.component';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { MultiSelectModule } from 'primeng/multiselect';
import { FormsModule } from '@angular/forms';
import { CategoriesApi } from '../../../core/categories/categories-api.service';
import type { CategoryRef } from '../../../core/categories/categories.models';

const GROUPS: Array<{ key: RuleGroup; label: string }> = [
  { key: 'floor', label: 'The hall floor' },
  { key: 'access', label: 'Passages and access' },
  { key: 'stalls', label: 'Stalls' },
  { key: 'layout', label: 'The whole layout' },
];

/**
 * One hall of an event: the floor stalls are planned on, and the rules that apply there. The
 * venue switches rules for this hall; organisers read them.
 */
@Component({
  selector: 'app-event-hall-page',
  imports: [
    DecimalPipe,
    RouterLink,
    ButtonModule,
    IconComponent,
    ProgressBarModule,
    FloorViewComponent,
    PageHeaderComponent,
    RulesSummaryComponent,
    ToggleSwitchModule,
    MultiSelectModule,
    FormsModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page page-narrow">
      @if (detail(); as d) {
        <a pButton [text]="true" class="back" [routerLink]="['/', slug(), 'events', d.event.id]"
          ><app-icon name="arrow_back" />{{ d.event.name }}</a
        >
      }
      @if (loading()) {
        <p-progressbar mode="indeterminate" />
      }
      @if (detail(); as d) {
        <app-page-header
          [heading]="d.hall.name"
          [subheading]="d.hall.venue.name + (d.hall.level ? ' · ' + d.hall.level : '')"
        >
          <span meta class="muted small nums">
            {{ d.hall.width | number: '1.0-1' }} × {{ d.hall.depth | number: '1.0-1' }} m ·
            {{ d.hall.floorArea | number: '1.0-0' }} m² · {{ d.event.audience }} event
          </span>
          @if (canPlan()) {
            <a pButton [routerLink]="['planner']"
              ><app-icon name="architecture" />{{
                d.plan.revision ? 'Open stall planner' : 'Plan stalls'
              }}</a
            >
          }
        </app-page-header>

        @if (d.plan.revision) {
          <p class="muted small nums plan-line">
            Stall plan: {{ d.plan.stalls }} {{ d.plan.stalls === 1 ? 'stall' : 'stalls' }} ·
            {{ d.plan.seats }} {{ d.plan.seats === 1 ? 'seat' : 'seats' }} · saved
            {{ d.plan.revision }} {{ d.plan.revision === 1 ? 'time' : 'times' }}
          </p>
        }

        <section class="panel">
          <h2 class="section-title">Stall categories</h2>
          @if (canManage()) {
            <p class="muted small">
              What stalls on this hall are sold as. The planner offers only these. Add categories
              under Categories.
            </p>
            <div class="row">
              <p-multiselect
                class="grow-select"
                [options]="categoryOptions()"
                optionLabel="name"
                optionValue="id"
                optionDisabled="disabled"
                [ngModel]="selectedCategories()"
                (ngModelChange)="selectedCategories.set($event)"
                placeholder="Choose categories"
                [filter]="true"
                display="chip"
                ariaLabel="Stall categories of this hall"
                appendTo="body"
              />
              <button
                pButton
                (click)="saveCategories()"
                [disabled]="busy() || !categoriesChanged()"
              >
                Save categories
              </button>
            </div>
          } @else if (d.categories.length) {
            <p class="chips">
              @for (c of d.categories; track c.id) {
                <span class="status-chip">{{ c.name }}</span>
              }
            </p>
          } @else {
            <p class="muted small">The venue has not chosen categories for this hall yet.</p>
          }
        </section>

        <section class="panel floor">
          <app-floor-view [floor]="d.floor" />
          @if (canManage() && d.hall.latestFloorVersion !== d.hall.floorVersion) {
            <p class="muted small">
              This event keeps floor version {{ d.hall.floorVersion }}, from when the hall was
              added. The hall is now at version {{ d.hall.latestFloorVersion }}.
            </p>
          }
        </section>

        @if (catalogue(); as c) {
          @if (canManage()) {
            <section class="panel">
              <div class="row">
                <div class="grow">
                  <h2 class="section-title">Rules for this hall</h2>
                  <p class="muted small">
                    Copied from your organisation’s rules when the hall was added. Switch them for
                    this event here; values stay as copied.
                  </p>
                </div>
                <button pButton [text]="true" (click)="reset()" [disabled]="busy()">
                  <app-icon name="restart_alt" />Copy organisation rules again
                </button>
              </div>
            </section>
            @for (g of groups; track g.key) {
              <section class="panel">
                <h2 class="section-title">{{ g.label }}</h2>
                <ul class="rules">
                  @for (r of rulesOf(c, g.key); track r.id) {
                    <li [class.waiting]="!r.available">
                      <p-toggleswitch
                        [ngModel]="d.rules.switches[r.id]"
                        (ngModelChange)="toggle(r.id, $event)"
                        [disabled]="!r.available || busy()"
                        [ariaLabel]="r.label"
                      />
                      <span class="rule">
                        <span class="rule-name"
                          >{{ r.label }} <span class="ref">{{ r.reference }}</span></span
                        >
                        <span class="muted small">{{ r.description }}</span>
                        @if (!r.available) {
                          <span class="muted small"
                            ><app-icon name="hourglass_empty" /> Takes effect with:
                            {{ r.waitingFor }}</span
                          >
                        }
                      </span>
                    </li>
                  }
                </ul>
              </section>
            }
          } @else {
            <app-rules-summary [rules]="asRules(d)" [catalogue]="c" />
          }
        }
      }
    </div>
  `,
  styles: `
    .back {
      justify-self: start;
      margin-bottom: -16px;
    }
    .small {
      font: var(--app-body-small);
    }
    .nums {
      font-variant-numeric: tabular-nums;
    }
    .plan-line {
      margin: -8px 0 0;
    }
    .grow-select {
      flex: 1 1 320px;
      min-width: 0;
    }
    .chips {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin: 0;
    }
    .floor {
      display: grid;
      gap: 8px;
    }
    .floor p {
      margin: 0;
    }
    .grow {
      flex: 1 1 280px;
      display: grid;
      gap: 2px;
    }
    .grow p {
      margin: 0;
    }
    .rules {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 14px;
    }
    .rules li {
      display: flex;
      gap: 14px;
      align-items: flex-start;
    }
    .rules li.waiting {
      opacity: 0.8;
    }
    .rule {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .rule-name {
      font-weight: 600;
    }
    .ref {
      font: var(--app-label-small);
      color: var(--app-primary);
      margin-left: 6px;
    }
  `,
})
export class EventHallPageComponent {
  /** From the route. */
  readonly eventId = input.required<string>();
  readonly hallId = input.required<string>();

  private readonly api = inject(EventsApi);
  private readonly rulesApi = inject(RulesApi);
  private readonly categoriesApi = inject(CategoriesApi);
  private readonly confirm = inject(ConfirmService);
  private readonly notifier = inject(Notifier);
  private readonly context = inject(OrgContextStore);

  protected readonly slug = this.context.slug;
  protected readonly groups = GROUPS;
  protected readonly canManage = computed(() => this.context.can('events.manage'));
  protected readonly canPlan = computed(() => this.context.can('layouts.view'));
  /** The organisation's categories: active ones, and inactive ones the hall already sells. */
  private readonly allCategories = signal<CategoryRef[]>([]);
  protected readonly selectedCategories = signal<string[]>([]);
  protected readonly categoryOptions = computed(() => {
    const on = new Set(this.detail()?.categories.map((c) => c.id) ?? []);
    return this.allCategories()
      .filter((c) => c.status === 'active' || on.has(c.id))
      .map((c) => ({
        ...c,
        name: c.status === 'active' ? c.name : `${c.name} (inactive)`,
        disabled: c.status !== 'active' && !this.selectedCategories().includes(c.id),
      }));
  });
  protected readonly categoriesChanged = computed(() => {
    const saved = (this.detail()?.categories ?? []).map((c) => c.id).sort();
    const now = [...this.selectedCategories()].sort();
    return saved.join() !== now.join();
  });
  protected readonly detail = signal<EventHallDetailView | null>(null);
  protected readonly catalogue = signal<RuleCatalogue | null>(null);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);

  constructor() {
    // Only the route inputs restart the load: the request itself reads the session signal.
    effect(() => {
      const [eventId, hallId] = [this.eventId(), this.hallId()];
      untracked(() => void this.load(eventId, hallId));
    });
  }

  private async load(eventId: string, hallId: string): Promise<void> {
    this.loading.set(true);
    try {
      const [detail, catalogue] = await Promise.all([
        firstValueFrom(this.api.hall(this.slug(), eventId, hallId)),
        this.catalogue() ?? firstValueFrom(this.rulesApi.catalogue(this.slug())),
      ]);
      this.show(detail);
      this.catalogue.set(catalogue);
      if (this.canManage() && !this.allCategories().length) {
        this.allCategories.set(await firstValueFrom(this.categoriesApi.list(this.slug())));
      }
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.loading.set(false);
    }
  }

  /** Shows the hall as the server has it, categories included. */
  private show(detail: EventHallDetailView): void {
    this.detail.set(detail);
    this.selectedCategories.set(detail.categories.map((c) => c.id));
  }

  protected async saveCategories(): Promise<void> {
    const d = this.detail();
    if (!d) return;
    this.busy.set(true);
    try {
      this.show(
        await firstValueFrom(
          this.api.setHallCategories(
            this.slug(),
            d.event.id,
            d.hall.hallId,
            this.selectedCategories(),
          ),
        ),
      );
      this.notifier.success('Categories saved.');
    } catch {
      // The error interceptor has shown it; show what is saved.
      this.show(d);
    } finally {
      this.busy.set(false);
    }
  }

  protected rulesOf(catalogue: RuleCatalogue, group: RuleGroup): RuleDefinition[] {
    return catalogue.rules.filter((r) => r.group === group);
  }

  /** The hall's rules in the shape the read-only summary shows. */
  protected asRules(d: EventHallDetailView): RulesView {
    return { ...d.rules, references: [], updatedAt: '' };
  }

  /** Each switch saves at once; the page shows what the server kept. */
  protected async toggle(id: RuleId, on: boolean): Promise<void> {
    const d = this.detail();
    if (!d) return;
    this.busy.set(true);
    try {
      this.detail.set(
        await firstValueFrom(
          this.api.setHallRules(this.slug(), d.event.id, d.hall.hallId, {
            ...d.rules.switches,
            [id]: on,
          }),
        ),
      );
    } catch {
      // The error interceptor has shown it; put the switch back.
      this.detail.set({ ...d });
    } finally {
      this.busy.set(false);
    }
  }

  protected async reset(): Promise<void> {
    const d = this.detail();
    if (!d) return;
    const ok = await this.confirm.confirm({
      title: 'Copy the organisation’s rules again?',
      message: `The switches, values and drawing profile of ${d.hall.name} for this event are replaced with your organisation’s current rules.`,
      confirmLabel: 'Copy rules',
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      this.detail.set(
        await firstValueFrom(this.api.resetHallRules(this.slug(), d.event.id, d.hall.hallId)),
      );
      this.notifier.success('Rules copied again.');
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
  }
}
