import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';

import type { RuleCatalogue, RuleId, Violation } from '../../../core/rules/rules.models';
import type { PlanRuleOverride, RuleReport } from '../../../core/stall-plans/stall-plans.models';
import type { EditStall } from './stall-plan-editing';

/**
 * A stall plan's rules report, as the server checked its saved stalls, and the rules set aside
 * with their reasons. Picking a violation shows it on the floor; the rules set aside are edited
 * here and saved with the plan.
 */
@Component({
  selector: 'app-stall-plan-report',
  imports: [
    DecimalPipe,
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel" aria-label="Rules check">
      <div class="row">
        <h3 class="section-title grow">Rules check</h3>
        <span
          class="status-chip"
          [class.is-positive]="report().passed"
          [class.is-warning]="!report().passed"
        >
          {{ report().passed ? 'Passes' : blocking() + ' to fix' }}
        </span>
      </div>
      <p class="muted small">
        {{ report().utilisation * 100 | number: '1.0-0' }}% of the stall floor used
      </p>
      @if (stale()) {
        <p class="small stale">
          <mat-icon>info</mat-icon>Checked at the last save. Save to check your changes.
        </p>
      }
      <ul class="violations">
        @for (v of report().violations; track $index) {
          <li [class.aside]="v.overridden" [class.focused]="v === focused()">
            <button
              type="button"
              class="pick"
              (click)="picked.emit(v)"
              [attr.aria-label]="'Show on the floor: ' + v.message"
            >
              <span class="ref">{{ ruleLabel(v.ruleId) }} · {{ v.reference }}</span>
              <span>{{ v.message }}</span>
            </button>
            @if (v.overridden; as o) {
              <span class="small muted"
                >Set aside: {{ o.reason }}{{ o.by ? ' (' + o.by + ')' : '' }}</span
              >
            } @else if (editable() && setAsideStalls(v) !== null) {
              <button mat-button class="aside-button" (click)="prefill(v)">Set aside…</button>
            }
          </li>
        } @empty {
          <li class="muted">Every checked rule passes.</li>
        }
      </ul>
      @if (offRules().length) {
        <p class="small muted">Not checked: {{ offRules().join(', ') }}.</p>
      }
    </section>

    <section class="panel" aria-label="Rules set aside">
      <h3 class="section-title">Rules set aside</h3>
      <p class="muted small">
        A rule set aside is saved with the plan, and its reason is shown at approval.
      </p>
      <ul class="overrides">
        @for (o of overrides(); track $index) {
          <li>
            <span class="grow">
              <span class="ref">{{ ruleLabel(o.ruleId) }}</span>
              <span class="small">{{ stallText(o.stallIds) }}</span>
              <span>{{ o.reason }}</span>
              @if (o.by) {
                <span class="small muted">By {{ o.by }}</span>
              }
            </span>
            @if (editable()) {
              <button
                mat-icon-button
                (click)="removeOverride($index)"
                [attr.aria-label]="'Stop setting aside ' + ruleLabel(o.ruleId)"
              >
                <mat-icon>close</mat-icon>
              </button>
            }
          </li>
        } @empty {
          <li class="muted">No rule is set aside.</li>
        }
      </ul>
      @if (editable()) {
        <div class="override-form">
          <mat-form-field>
            <mat-label>Rule</mat-label>
            <mat-select [ngModel]="ruleId()" (ngModelChange)="ruleId.set($event)">
              @for (id of ruleOptions(); track id) {
                <mat-option [value]="id">{{ ruleLabel(id) }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Stalls</mat-label>
            <mat-select
              multiple
              placeholder="Every stall"
              [ngModel]="stallIds()"
              (ngModelChange)="stallIds.set($event)"
            >
              @for (s of savedStalls(); track s.key) {
                <mat-option [value]="s.id">{{ s.number }}</mat-option>
              }
            </mat-select>
            <mat-hint>Leave empty for every stall. New stalls can be chosen once saved.</mat-hint>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Reason (shown at approval)</mat-label>
            <input matInput [(ngModel)]="reason" maxlength="500" />
          </mat-form-field>
          <button
            mat-stroked-button
            (click)="addOverride()"
            [disabled]="!ruleId() || reason.trim().length < 3"
          >
            <mat-icon>add</mat-icon>Set aside
          </button>
        </div>
      }
    </section>
  `,
  styles: `
    :host {
      display: grid;
      gap: 16px;
    }
    .panel {
      padding: 16px;
    }
    .small {
      font: var(--mat-sys-body-small);
    }
    .grow {
      flex: 1 1 auto;
      margin: 0;
    }
    .section-title {
      margin: 0 0 8px;
    }
    .stale {
      display: flex;
      gap: 6px;
      align-items: center;
      padding: 6px 10px;
      border-radius: 10px;
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
    }
    .stale mat-icon {
      width: 18px;
      height: 18px;
      font-size: 18px;
    }
    .violations,
    .overrides {
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
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
      transition: box-shadow 150ms ease-out;
    }
    .violations li.aside {
      background: var(--mat-sys-surface-container-high);
      color: inherit;
    }
    .violations li:not(.muted):hover {
      box-shadow: inset 0 0 0 1px currentColor;
    }
    /* Same weight as the hover rule above, so a picked row keeps its outline on hover. */
    .violations li.focused:not(.muted) {
      box-shadow: inset 0 0 0 2px var(--mat-sys-primary);
    }
    .violations li.muted,
    .overrides li.muted {
      background: none;
      padding: 0;
      color: var(--mat-sys-on-surface-variant);
    }
    .pick {
      display: grid;
      gap: 2px;
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .pick:focus-visible {
      outline: 2px solid var(--mat-sys-primary);
      outline-offset: 4px;
      border-radius: 4px;
    }
    .aside-button {
      justify-self: start;
    }
    .ref {
      font: var(--mat-sys-label-medium);
    }
    .overrides li {
      display: flex;
      gap: 8px;
      align-items: flex-start;
      padding: 8px 10px;
      border-radius: 10px;
      background: var(--mat-sys-surface-container-high);
    }
    .overrides li > .grow {
      display: grid;
      gap: 2px;
    }
    .override-form {
      display: grid;
      margin-top: 16px;
    }
    .override-form button {
      justify-self: start;
    }
    @media (prefers-reduced-motion: reduce) {
      .violations li {
        transition: none;
      }
    }
  `,
})
export class StallPlanReportComponent {
  readonly report = input.required<RuleReport>();
  readonly catalogue = input<RuleCatalogue | null>(null);
  readonly stalls = input.required<EditStall[]>();
  readonly overrides = input.required<PlanRuleOverride[]>();
  /** The rules set aside can change (a draft the member draws). */
  readonly editable = input(false);
  /** The stalls changed since the report was made. */
  readonly stale = input(false);
  readonly focused = input<Violation | null>(null);
  readonly picked = output<Violation>();
  readonly overridesChange = output<PlanRuleOverride[]>();

  protected readonly ruleId = signal<RuleId | null>(null);
  protected readonly stallIds = signal<string[]>([]);
  protected reason = '';

  protected readonly blocking = computed(
    () => this.report().violations.filter((v) => !v.overridden).length,
  );
  protected readonly offRules = computed(() =>
    this.report()
      .rules.filter((r) => r.state !== 'checked')
      .map((r) => this.ruleLabel(r.id)),
  );
  /** Only the rules the organisation checks can be set aside. */
  protected readonly ruleOptions = computed(() =>
    this.report()
      .rules.filter((r) => r.state === 'checked')
      .map((r) => r.id),
  );
  protected readonly savedStalls = computed(() => this.stalls().filter((s) => s.id !== null));

  protected ruleLabel(id: string): string {
    if (id.startsWith('profile.')) return 'Drawing profile';
    return this.catalogue()?.rules.find((r) => r.id === id)?.label ?? id;
  }

  protected stallText(ids: string[] | null | undefined): string {
    if (!ids?.length) return 'Every stall';
    const numbers = new Map(this.stalls().map((s) => [s.key, s.number]));
    const shown = ids.map((id) => numbers.get(id) ?? '?').join(', ');
    return `${ids.length === 1 ? 'Stall' : 'Stalls'} ${shown}`;
  }

  /**
   * The stalls a violation would be set aside for: [] for a rule on the whole plan, null when
   * it cannot be (a drawing profile check, or a stall removed since the check).
   */
  protected setAsideStalls(v: Violation): string[] | null {
    if (v.ruleId.startsWith('profile.')) return null;
    const saved = new Set(this.savedStalls().map((s) => s.id));
    return v.stallIds.every((id) => saved.has(id)) ? v.stallIds : null;
  }

  protected prefill(v: Violation): void {
    this.ruleId.set(v.ruleId as RuleId);
    this.stallIds.set(this.setAsideStalls(v) ?? []);
    this.reason = '';
  }

  protected addOverride(): void {
    const ruleId = this.ruleId();
    if (!ruleId) return;
    const stallIds = this.stallIds();
    this.overridesChange.emit([
      ...this.overrides(),
      { ruleId, stallIds: stallIds.length ? stallIds : null, reason: this.reason.trim() },
    ]);
    this.ruleId.set(null);
    this.stallIds.set([]);
    this.reason = '';
  }

  protected removeOverride(index: number): void {
    this.overridesChange.emit(this.overrides().filter((_, i) => i !== index));
  }
}
