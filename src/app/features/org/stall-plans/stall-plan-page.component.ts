import { DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import type { FloorArea } from '../../../core/api/api.models';
import { errorMessage, httpStatus } from '../../../core/api/http-error';
import { EVENT_STATUS_LABELS } from '../../../core/events/event-rules';
import { OrgContextStore } from '../../../core/org/org.stores';
import { RulesApi } from '../../../core/rules/rules-api.service';
import type { RuleCatalogue, StallSide, Violation } from '../../../core/rules/rules.models';
import { StallPlansApi } from '../../../core/stall-plans/stall-plans-api.service';
import {
  STALL_TYPES,
  type PlanRuleOverride,
  type StallPlanStatus,
  type StallPlanView,
  type StallType,
} from '../../../core/stall-plans/stall-plans.models';
import { ConfirmService } from '../../../core/ui/confirm.service';
import { Notifier } from '../../../core/ui/notifier.service';
import type { MultiPolygon } from '../../../core/venues/floor-plan.models';
import { EmptyStateComponent } from '../../../shared/empty-state.component';
import { AREA_COLORS } from '../../../shared/floor/floor-view.component';
import { PageHeaderComponent } from '../../../shared/page-header.component';
import {
  EditStall,
  editStalls,
  isDirty,
  nextStallNumber,
  planActions,
  planInput,
  planProblems,
  readOnlyReason,
  SIDES,
  withoutStall,
} from './stall-plan-editing';
import { StallPlanReportComponent } from './stall-plan-report.component';

const STATUS_LABELS: Record<StallPlanStatus, string> = {
  draft: 'Draft',
  approved: 'Approved',
  published: 'Published',
};

const TYPE_LABELS: Record<StallType, string> = { shell: 'Shell scheme', bare: 'Bare space' };

const SIDE_LABELS: Record<StallSide, string> = {
  top: 'Top',
  bottom: 'Bottom',
  left: 'Left',
  right: 'Right',
};

const DONE: Record<'approve' | 'publish' | 'reopen', string> = {
  approve: 'Plan approved.',
  publish: 'Plan published: its stalls are open for booking.',
  reopen: 'Plan reopened as a draft.',
};

/**
 * The stall plan of one hall of an event: stalls drawn on the floor version the event booked,
 * checked against the organisation's rules by the server on every save, then approved and
 * published to booking. Drawing needs `layouts.edit` and a draft; each step its own permission.
 */
@Component({
  selector: 'app-stall-plan-page',
  imports: [
    DatePipe,
    DecimalPipe,
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    EmptyStateComponent,
    PageHeaderComponent,
    StallPlanReportComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <a mat-button class="back" [routerLink]="['/', slug(), 'events', eventId()]">
        <mat-icon>arrow_back</mat-icon>{{ view()?.event?.name ?? 'Event' }}
      </a>

      @if (view(); as v) {
        <app-page-header [heading]="'Stall plan · ' + v.hall.name" [subheading]="v.event.name">
          <span meta class="meta">
            <span
              class="status-chip"
              [class.is-neutral]="v.status === 'draft'"
              [class.is-positive]="v.status === 'published'"
              >{{ statusLabels[v.status] }}</span
            >
            <span class="status-chip is-neutral"
              >{{ eventStatusLabels[v.event.status] }} event</span
            >
            <span class="muted small">{{
              v.revision ? 'Revision ' + v.revision : 'Not saved yet'
            }}</span>
            @if (v.hall.floorVersion !== v.hall.currentVersion) {
              <span class="muted small"
                >Floor version {{ v.hall.floorVersion }} (hall is now at
                {{ v.hall.currentVersion }})</span
              >
            } @else {
              <span class="muted small">Floor version {{ v.hall.floorVersion }}</span>
            }
            @if (v.publishedAt) {
              <span class="muted small"
                >Published {{ v.publishedAt | date: 'd MMM y, HH:mm' }}</span
              >
            } @else if (v.approvedAt) {
              <span class="muted small">Approved {{ v.approvedAt | date: 'd MMM y, HH:mm' }}</span>
            }
            @if (v.activeBookings) {
              <span class="muted small"
                >{{ v.activeBookings }} active
                {{ v.activeBookings === 1 ? 'booking' : 'bookings' }}</span
              >
            }
            @if (dirty()) {
              <span class="status-chip is-warning">Unsaved changes</span>
            }
          </span>
          @if (actions().remove) {
            <button mat-button class="danger" (click)="remove()" [disabled]="busy()">
              <mat-icon>delete</mat-icon>Delete draft
            </button>
          }
          @if (actions().reopen) {
            <button mat-stroked-button (click)="step('reopen')" [disabled]="busy()">
              <mat-icon>edit_note</mat-icon>Reopen as draft
            </button>
          }
          @if (actions().edit && dirty()) {
            <button mat-button (click)="discard()" [disabled]="busy()">Discard changes</button>
          }
          <!-- One filled action: Save while there is something to save, else Approve. -->
          @if (actions().edit) {
            @if (dirty() || !actions().approve) {
              <button
                mat-flat-button
                (click)="save()"
                [disabled]="!dirty() || problems().length > 0 || busy()"
              >
                <mat-icon>save</mat-icon>Save
              </button>
            } @else {
              <button
                mat-stroked-button
                (click)="save()"
                [disabled]="!dirty() || problems().length > 0 || busy()"
              >
                <mat-icon>save</mat-icon>Save
              </button>
            }
          }
          @if (actions().approve) {
            @if (dirty()) {
              <button
                mat-stroked-button
                (click)="step('approve')"
                [disabled]="dirty() || busy()"
                [title]="dirty() ? 'Save your changes first' : ''"
              >
                <mat-icon>task_alt</mat-icon>Approve
              </button>
            } @else {
              <button mat-flat-button (click)="step('approve')" [disabled]="busy()">
                <mat-icon>task_alt</mat-icon>Approve
              </button>
            }
          }
          @if (actions().publish) {
            <button mat-flat-button (click)="step('publish')" [disabled]="busy()">
              <mat-icon>send</mat-icon>Publish to booking
            </button>
          }
        </app-page-header>
      } @else if (loading()) {
        <div class="skeleton-header" aria-hidden="true">
          <span class="skeleton line wide"></span>
          <span class="skeleton line"></span>
        </div>
      }

      @if (loading()) {
        <mat-progress-bar mode="indeterminate" />
      }

      @if (conflict(); as message) {
        <div class="panel conflict" role="alert">
          <mat-icon>sync_problem</mat-icon>
          <span class="grow">{{ message }}</span>
          <button mat-button (click)="conflict.set(null)">Dismiss</button>
          <button mat-flat-button (click)="reload()">Reload plan</button>
        </div>
      }

      @if (view(); as v) {
        @if (readOnly(); as reason) {
          <p class="read-only muted">
            <mat-icon>lock</mat-icon><span>{{ reason }}</span>
          </p>
        }
        @if (actions().edit && problems().length) {
          <ul class="problems" role="alert">
            @for (p of problems(); track p) {
              <li>{{ p }}</li>
            }
          </ul>
        }

        <div class="layout">
          <div class="main">
            <section class="panel stage" aria-label="Stall plan">
              @if (stalls().length) {
                <div class="row bar">
                  <span class="muted small">
                    @if (actions().edit) {
                      Click the floor to place a {{ newStall().width }} × {{ newStall().depth }} m
                      stall. Click a stall to change it.
                    } @else {
                      Click a stall to see it.
                    }
                  </span>
                  <span class="spacer"></span>
                  <span class="muted small facts"
                    >{{ stalls().length }} {{ stalls().length === 1 ? 'stall' : 'stalls' }} ·
                    {{ stallArea() | number: '1.0-1' }} m²</span
                  >
                </div>
              } @else {
                <app-empty-state
                  class="stage-empty"
                  icon="grid_view"
                  [heading]="actions().edit ? 'No stalls yet. Add the first one.' : 'No stalls yet'"
                  [text]="
                    actions().edit
                      ? 'Click the floor where it should stand, or enter its position under New stall.'
                      : 'Nobody has drawn stalls on this plan yet.'
                  "
                />
              }
              <svg
                #svg
                [attr.viewBox]="viewBox()"
                preserveAspectRatio="xMidYMid meet"
                [class.drawing]="actions().edit"
                (click)="place($event, svg)"
                role="img"
                [attr.aria-label]="'Floor of ' + v.hall.name + ' with its stalls'"
              >
                <defs>
                  <pattern id="plan-grid" width="1" height="1" patternUnits="userSpaceOnUse">
                    <path d="M 1 0 L 0 0 0 1" fill="none" class="grid-line" />
                  </pattern>
                </defs>
                <rect
                  [attr.x]="-2"
                  [attr.y]="-2"
                  [attr.width]="v.floor.width + 4"
                  [attr.height]="v.floor.depth + 4"
                  class="ground"
                />
                @if (v.floor.geometry; as g) {
                  <path [attr.d]="path(g.boundary)" class="floor" fill-rule="evenodd" />
                  <path [attr.d]="path(g.boundary)" fill="url(#plan-grid)" fill-rule="evenodd" />
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
                  <rect [attr.width]="v.floor.width" [attr.height]="v.floor.depth" class="floor" />
                  <rect
                    [attr.width]="v.floor.width"
                    [attr.height]="v.floor.depth"
                    fill="url(#plan-grid)"
                  />
                  @for (a of v.floor.areas; track $index) {
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
                @for (violation of shownViolations(); track $index) {
                  @for (r of violation.areas; track $index) {
                    <rect
                      [attr.x]="r.x"
                      [attr.y]="r.y"
                      [attr.width]="r.width"
                      [attr.height]="r.height"
                      class="violation"
                      [class.aside]="violation.overridden"
                      [class.focused]="violation === focused()"
                    />
                  }
                }
                @for (s of stalls(); track s.key) {
                  <g
                    (click)="select(s.key, $event)"
                    class="stall"
                    [class.selected]="s.key === selectedKey()"
                    [class.bad]="bad().has(s.key)"
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
                <span class="key-item"><span class="k stall-k"></span>Stall</span>
                <span class="key-item"><span class="k bad-k"></span>Breaks a rule</span>
                <span class="key-item"><span class="k aside-k"></span>Rule set aside</span>
                <span class="key-item"
                  ><span class="k open-k"></span>Dashed edges are open sides</span
                >
              </p>
            </section>

            @if (stalls().length) {
              <section class="panel" aria-label="Stalls">
                <h3 class="section-title">Stalls</h3>
                <ul class="stall-list">
                  @for (s of stalls(); track s.key) {
                    <li>
                      <button
                        type="button"
                        class="stall-item"
                        [class.selected]="s.key === selectedKey()"
                        [class.bad]="bad().has(s.key)"
                        (click)="selectedKey.set(s.key)"
                        [attr.aria-label]="'Stall ' + s.number"
                      >
                        <b>{{ s.number }}</b>
                        <span class="muted"
                          >{{ s.width | number: '1.0-2' }} × {{ s.depth | number: '1.0-2' }} m</span
                        >
                        <span class="spacer"></span>
                        @if (!s.id) {
                          <span class="status-chip is-neutral">New</span>
                        }
                      </button>
                    </li>
                  }
                </ul>
              </section>
            }
          </div>

          <aside class="side">
            @if (actions().edit) {
              <section class="panel" aria-label="New stall">
                <h3 class="section-title">New stall</h3>
                <div class="pair">
                  <mat-form-field
                    ><mat-label>New stall x</mat-label
                    ><input
                      matInput
                      type="number"
                      step="0.5"
                      [ngModel]="newStall().x"
                      (ngModelChange)="setNew('x', $event)"
                    /><span matTextSuffix>m</span></mat-form-field
                  >
                  <mat-form-field
                    ><mat-label>New stall y</mat-label
                    ><input
                      matInput
                      type="number"
                      step="0.5"
                      [ngModel]="newStall().y"
                      (ngModelChange)="setNew('y', $event)"
                    /><span matTextSuffix>m</span></mat-form-field
                  >
                  <mat-form-field
                    ><mat-label>New stall width</mat-label
                    ><input
                      matInput
                      type="number"
                      min="0.5"
                      step="0.5"
                      [ngModel]="newStall().width"
                      (ngModelChange)="setNew('width', $event)"
                    /><span matTextSuffix>m</span></mat-form-field
                  >
                  <mat-form-field
                    ><mat-label>New stall depth</mat-label
                    ><input
                      matInput
                      type="number"
                      min="0.5"
                      step="0.5"
                      [ngModel]="newStall().depth"
                      (ngModelChange)="setNew('depth', $event)"
                    /><span matTextSuffix>m</span></mat-form-field
                  >
                </div>
                <button mat-stroked-button (click)="addStall()">
                  <mat-icon>add</mat-icon>Add stall
                </button>
              </section>
            }

            @if (selected(); as s) {
              <section class="panel" aria-label="Selected stall">
                <div class="row">
                  <h3 class="section-title grow">Stall {{ s.number }}</h3>
                  @if (!s.id) {
                    <span class="status-chip is-neutral">New</span>
                  }
                  @if (actions().edit) {
                    <button
                      mat-icon-button
                      (click)="removeSelected()"
                      aria-label="Delete this stall"
                    >
                      <mat-icon>delete</mat-icon>
                    </button>
                  }
                </div>
                @if (actions().edit) {
                  <mat-form-field class="full-width"
                    ><mat-label>Stall number</mat-label
                    ><input
                      matInput
                      maxlength="40"
                      [ngModel]="s.number"
                      (ngModelChange)="update({ number: $event })"
                  /></mat-form-field>
                  <div class="pair">
                    <mat-form-field
                      ><mat-label>x</mat-label
                      ><input
                        matInput
                        type="number"
                        step="0.5"
                        [ngModel]="s.x"
                        (ngModelChange)="edit('x', $event)"
                      /><span matTextSuffix>m</span></mat-form-field
                    >
                    <mat-form-field
                      ><mat-label>y</mat-label
                      ><input
                        matInput
                        type="number"
                        step="0.5"
                        [ngModel]="s.y"
                        (ngModelChange)="edit('y', $event)"
                      /><span matTextSuffix>m</span></mat-form-field
                    >
                    <mat-form-field
                      ><mat-label>Width</mat-label
                      ><input
                        matInput
                        type="number"
                        step="0.5"
                        min="0.5"
                        [ngModel]="s.width"
                        (ngModelChange)="edit('width', $event)"
                      /><span matTextSuffix>m</span></mat-form-field
                    >
                    <mat-form-field
                      ><mat-label>Depth</mat-label
                      ><input
                        matInput
                        type="number"
                        step="0.5"
                        min="0.5"
                        [ngModel]="s.depth"
                        (ngModelChange)="edit('depth', $event)"
                      /><span matTextSuffix>m</span></mat-form-field
                    >
                  </div>
                  <mat-form-field class="full-width">
                    <mat-label>Stall type</mat-label>
                    <mat-select
                      [ngModel]="s.stallType"
                      (ngModelChange)="update({ stallType: $event })"
                    >
                      <mat-option [value]="null">Not set</mat-option>
                      @for (t of stallTypes; track t) {
                        <mat-option [value]="t">{{ typeLabels[t] }}</mat-option>
                      }
                    </mat-select>
                  </mat-form-field>
                  <span class="muted small">Open sides</span>
                  <mat-button-toggle-group
                    multiple
                    [value]="s.openSides"
                    (change)="update({ openSides: $event.value })"
                    aria-label="Open sides"
                  >
                    @for (side of sides; track side) {
                      <mat-button-toggle [value]="side">{{ sideLabels[side] }}</mat-button-toggle>
                    }
                  </mat-button-toggle-group>
                } @else {
                  <dl class="facts-list">
                    <dt>Position</dt>
                    <dd>x {{ s.x | number: '1.0-2' }} m · y {{ s.y | number: '1.0-2' }} m</dd>
                    <dt>Size</dt>
                    <dd>
                      {{ s.width | number: '1.0-2' }} × {{ s.depth | number: '1.0-2' }} m ·
                      {{ s.width * s.depth | number: '1.0-2' }} m²
                    </dd>
                    <dt>Open sides</dt>
                    <dd>{{ s.openSides.length ? sideList(s.openSides) : 'None' }}</dd>
                    <dt>Type</dt>
                    <dd>{{ s.stallType ? typeLabels[s.stallType] : 'Not set' }}</dd>
                  </dl>
                }
              </section>
            }

            <app-stall-plan-report
              [report]="v.report"
              [catalogue]="catalogue()"
              [stalls]="stalls()"
              [overrides]="overrides()"
              [editable]="actions().edit"
              [stale]="dirty()"
              [focused]="focused()"
              (picked)="pick($event)"
              (overridesChange)="overrides.set($event)"
            />
          </aside>
        </div>
      } @else if (loading()) {
        <div class="layout" aria-hidden="true">
          <div class="panel skeleton stage-skeleton"></div>
          <div class="side">
            <div class="panel skeleton block"></div>
            <div class="panel skeleton block tall"></div>
          </div>
        </div>
      } @else if (missing(); as message) {
        <div class="panel">
          <app-empty-state icon="event_busy" [heading]="message">
            <a mat-stroked-button [routerLink]="['/', slug(), 'events', eventId()]"
              >Back to the event</a
            >
          </app-empty-state>
        </div>
      } @else if (failed()) {
        <div class="panel">
          <app-empty-state
            icon="cloud_off"
            heading="The stall plan could not be loaded"
            text="Check your connection, then try again."
          >
            <button mat-flat-button (click)="load()">Try again</button>
          </app-empty-state>
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      /* AREA_COLORS.outside reads this, as on the venue floor view and the booking map. */
      --floor-outside: var(--mat-sys-surface-container);
    }
    .back {
      justify-self: start;
      margin-bottom: -16px;
    }
    .meta {
      display: flex;
      gap: 6px 10px;
      flex-wrap: wrap;
      align-items: center;
      margin-top: 8px;
    }
    .small {
      font: var(--mat-sys-body-small);
    }
    .grow {
      flex: 1 1 auto;
      margin: 0;
    }
    .conflict {
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
      padding: 12px 16px;
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
      border-color: transparent;
    }
    .read-only {
      display: flex;
      gap: 8px;
      align-items: center;
      margin: -8px 0;
    }
    .read-only span {
      max-width: 65ch;
    }
    .problems {
      margin: -8px 0;
      padding: 12px 16px 12px 32px;
      border-radius: 12px;
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }
    .problems li {
      max-width: 65ch;
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 340px;
      gap: 16px;
      align-items: start;
    }
    .main {
      display: grid;
      gap: 16px;
      min-width: 0;
    }
    .stage svg {
      display: block;
      width: 100%;
      height: auto;
      max-height: 72vh;
    }
    .stage svg.drawing {
      cursor: crosshair;
    }
    .bar {
      margin-bottom: 8px;
    }
    .stage-empty {
      padding: 8px 16px 24px;
    }
    .facts {
      font-variant-numeric: tabular-nums;
    }
    .ground {
      fill: var(--mat-sys-surface-container);
    }
    .floor {
      fill: var(--mat-sys-surface-container-lowest);
      stroke: var(--mat-sys-outline);
      stroke-width: 0.1;
    }
    .grid-line {
      stroke: var(--mat-sys-outline-variant);
      stroke-width: 0.03;
    }
    .foyer {
      fill: var(--mat-sys-tertiary-container);
      fill-opacity: 0.6;
    }
    .object {
      fill-opacity: 0.6;
      stroke: var(--mat-sys-outline);
      stroke-opacity: 0.5;
      stroke-width: 0.05;
    }
    /* Theme tokens only, so the floor reads the same in light and dark mode. */
    .violation {
      fill: var(--mat-sys-error);
      fill-opacity: 0.3;
      stroke: var(--mat-sys-error);
      stroke-width: 0.08;
      pointer-events: none;
    }
    .violation.aside {
      fill: var(--mat-sys-tertiary);
      stroke: var(--mat-sys-tertiary);
    }
    .violation.focused {
      stroke: var(--mat-sys-on-surface);
      stroke-width: 0.25;
    }
    /*
     * Stall looks, the same tokens as the booking stall map (bookings/stall-map.component.ts):
     * a stall as "own" there (primary), a stall breaking a rule as "booked" (error-container),
     * a rule set aside as "held" (tertiary-container). Each sets a fill, ink and edge.
     */
    .stall,
    .stall-k {
      --stall-fill: var(--mat-sys-primary);
      --stall-ink: var(--mat-sys-on-primary);
      --stall-edge: var(--mat-sys-primary);
    }
    .stall.bad,
    .bad-k {
      --stall-fill: var(--mat-sys-error-container);
      --stall-ink: var(--mat-sys-on-error-container);
      --stall-edge: var(--mat-sys-error);
    }
    .aside-k {
      --stall-fill: var(--mat-sys-tertiary-container);
      --stall-edge: var(--mat-sys-tertiary);
    }
    .stall {
      cursor: pointer;
    }
    .stall rect {
      fill: var(--stall-fill);
      stroke: var(--stall-edge);
      stroke-width: 0.08;
      transition:
        stroke 150ms ease-out,
        stroke-width 150ms ease-out;
    }
    .stall:hover rect {
      stroke: var(--mat-sys-on-surface);
      stroke-width: 0.15;
    }
    .stall.selected rect {
      stroke: var(--mat-sys-on-surface);
      stroke-width: 0.3;
    }
    .stall .open {
      stroke: var(--stall-ink);
      stroke-width: 0.2;
      stroke-dasharray: 0.4 0.25;
      pointer-events: none;
    }
    .stall text {
      font-size: 0.9px;
      fill: var(--stall-ink);
      text-anchor: middle;
      dominant-baseline: middle;
      pointer-events: none;
    }
    .key {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 16px;
      align-items: center;
      margin: 12px 0 0;
    }
    .key-item {
      display: inline-flex;
      gap: 6px;
      align-items: center;
    }
    .k {
      display: inline-block;
      width: 12px;
      height: 12px;
      box-sizing: border-box;
      border-radius: 3px;
      border: 1px solid var(--stall-edge);
      background: var(--stall-fill);
    }
    .k.open-k {
      border: none;
      border-radius: 0;
      height: 0;
      border-top: 2px dashed var(--mat-sys-on-surface-variant);
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
    .facts-list {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 4px 12px;
      margin: 0;
    }
    .facts-list dt {
      color: var(--mat-sys-on-surface-variant);
    }
    .facts-list dd {
      margin: 0;
      font-variant-numeric: tabular-nums;
    }
    .stall-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 4px;
      max-height: 320px;
      overflow-y: auto;
    }
    .stall-item {
      display: flex;
      gap: 10px;
      align-items: center;
      width: 100%;
      padding: 6px 10px;
      border: 1px solid transparent;
      border-radius: 10px;
      background: none;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
      transition:
        background-color 150ms ease-out,
        border-color 150ms ease-out;
    }
    .stall-item:hover,
    .stall-item:focus-visible {
      background: var(--mat-sys-surface-container-high);
    }
    .stall-item:focus-visible {
      outline: 2px solid var(--mat-sys-primary);
      outline-offset: 1px;
    }
    .stall-item.selected {
      border-color: var(--mat-sys-primary);
    }
    .stall-item.bad b {
      color: var(--mat-sys-error);
    }
    /* Static placeholders: the progress bar above already shows the page is loading. */
    .skeleton {
      background: var(--mat-sys-surface-container-high);
      border-color: transparent;
    }
    .skeleton-header {
      display: grid;
      gap: 10px;
    }
    .skeleton.line {
      display: block;
      height: 14px;
      width: 220px;
      border-radius: 7px;
    }
    .skeleton.line.wide {
      height: 28px;
      width: 360px;
      max-width: 100%;
    }
    .stage-skeleton {
      aspect-ratio: 4 / 3;
    }
    .skeleton.block {
      height: 160px;
    }
    .skeleton.block.tall {
      height: 280px;
    }
    @media (max-width: 1100px) {
      .layout {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .stall rect,
      .stall-item {
        transition: none;
      }
    }
  `,
})
export class StallPlanPageComponent implements OnInit {
  /** From the route. */
  readonly eventId = input.required<string>();
  readonly hallId = input.required<string>();

  private readonly api = inject(StallPlansApi);
  private readonly rules = inject(RulesApi);
  private readonly confirm = inject(ConfirmService);
  private readonly notifier = inject(Notifier);
  private readonly context = inject(OrgContextStore);

  protected readonly sides = SIDES;
  protected readonly stallTypes = STALL_TYPES;
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly eventStatusLabels = EVENT_STATUS_LABELS;
  protected readonly typeLabels = TYPE_LABELS;
  protected readonly sideLabels = SIDE_LABELS;
  protected readonly slug = this.context.slug;

  /** The plan as the server last returned it. */
  protected readonly view = signal<StallPlanView | null>(null);
  /** The stalls and rules set aside as the editor holds them. */
  protected readonly stalls = signal<EditStall[]>([]);
  protected readonly overrides = signal<PlanRuleOverride[]>([]);
  protected readonly selectedKey = signal<string | null>(null);
  protected readonly focused = signal<Violation | null>(null);
  protected readonly newStall = signal({ x: 0, y: 0, width: 3, depth: 3 });
  protected readonly catalogue = signal<RuleCatalogue | null>(null);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);
  /** The server's reason the plan is not there to see (404). */
  protected readonly missing = signal<string | null>(null);
  /** The server's reason a save or step was refused (409), with a way to reload. */
  protected readonly conflict = signal<string | null>(null);
  protected readonly busy = signal(false);
  private counter = 0;

  private readonly can = (permission: string) => this.context.can(permission);

  protected readonly actions = computed(() => {
    const view = this.view();
    return view
      ? planActions(view, this.can)
      : { edit: false, approve: false, publish: false, reopen: false, remove: false };
  });
  protected readonly readOnly = computed(() => {
    const view = this.view();
    return view ? readOnlyReason(view, this.can) : null;
  });
  protected readonly dirty = computed(() => {
    const view = this.view();
    return view !== null && isDirty(view, this.stalls(), this.overrides());
  });
  protected readonly problems = computed(() => planProblems(this.stalls()));
  protected readonly selected = computed(
    () => this.stalls().find((s) => s.key === this.selectedKey()) ?? null,
  );
  protected readonly stallArea = computed(() =>
    this.stalls().reduce((sum, s) => sum + s.width * s.depth, 0),
  );
  /** The report is about the saved stalls: drawn on the floor only while nothing changed. */
  protected readonly shownViolations = computed(() =>
    this.dirty() ? [] : (this.view()?.report.violations ?? []),
  );
  protected readonly bad = computed(
    () =>
      new Set(
        this.shownViolations()
          .filter((v) => !v.overridden)
          .flatMap((v) => v.stallIds),
      ),
  );
  protected readonly viewBox = computed(() => {
    const f = this.view()?.floor;
    return f ? `-2 -2 ${f.width + 4} ${f.depth + 4}` : '0 0 1 1';
  });

  ngOnInit(): void {
    void this.load();
    if (this.context.can('rules.view')) void this.loadCatalogue();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.failed.set(false);
    this.missing.set(null);
    try {
      this.reset(await firstValueFrom(this.api.get(this.slug(), this.eventId(), this.hallId())));
    } catch (error) {
      if (httpStatus(error) === 404) {
        this.view.set(null);
        this.missing.set(errorMessage(error));
      } else {
        // The error interceptor has shown it.
        this.failed.set(true);
      }
    } finally {
      this.loading.set(false);
    }
  }

  /** Rule names for the report; without them it shows the rules' ids. */
  private async loadCatalogue(): Promise<void> {
    try {
      this.catalogue.set(await firstValueFrom(this.rules.catalogue(this.slug())));
    } catch {
      // The error interceptor has shown it.
    }
  }

  private reset(view: StallPlanView): void {
    this.view.set(view);
    this.stalls.set(editStalls(view));
    this.overrides.set(view.overrides);
    this.conflict.set(null);
    this.focused.set(null);
    if (!this.selected()) this.selectedKey.set(null);
  }

  protected async reload(): Promise<void> {
    if (this.dirty() && !(await this.confirmDiscard())) return;
    await this.load();
  }

  protected async discard(): Promise<void> {
    const view = this.view();
    if (view && (await this.confirmDiscard())) this.reset(view);
  }

  private confirmDiscard(): Promise<boolean> {
    return this.confirm.confirm({
      title: 'Discard the unsaved changes?',
      message: 'The stalls and rules set aside go back to the last saved plan.',
      confirmLabel: 'Discard',
      destructive: true,
    });
  }

  protected setNew(field: 'x' | 'y' | 'width' | 'depth', raw: number | string): void {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    if ((field === 'width' || field === 'depth') && n <= 0) return;
    this.newStall.update((s) => ({ ...s, [field]: n }));
  }

  protected addStall(): void {
    const { x, y } = this.newStall();
    this.add(x, y);
  }

  /** A click on the floor places a stall, its corner on the nearest whole metre. */
  protected place(event: MouseEvent, element: Element): void {
    if (!this.actions().edit) {
      this.selectedKey.set(null);
      return;
    }
    const m = (element as SVGSVGElement).getScreenCTM();
    if (!m) return;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(m.inverse());
    this.add(Math.floor(p.x), Math.floor(p.y));
  }

  private add(x: number, y: number): void {
    const { width, depth } = this.newStall();
    const key = `new-${++this.counter}`;
    this.stalls.update((list) => [
      ...list,
      {
        key,
        id: null,
        number: nextStallNumber(list),
        x,
        y,
        width,
        depth,
        openSides: ['bottom'],
        stallType: null,
      },
    ]);
    this.selectedKey.set(key);
  }

  protected select(key: string, event: MouseEvent): void {
    event.stopPropagation();
    this.selectedKey.set(key);
  }

  /** A violation picked in the report: its first stall is selected, its areas outlined. */
  protected pick(violation: Violation): void {
    this.focused.set(violation);
    const key = violation.stallIds.find((id) => this.stalls().some((s) => s.key === id));
    if (key) this.selectedKey.set(key);
  }

  protected edit(field: 'x' | 'y' | 'width' | 'depth', raw: number | string): void {
    const n = Number(raw);
    if (Number.isFinite(n)) this.update({ [field]: n });
  }

  protected update(change: Partial<Omit<EditStall, 'key' | 'id'>>): void {
    const key = this.selectedKey();
    this.stalls.update((list) => list.map((s) => (s.key === key ? { ...s, ...change } : s)));
  }

  protected removeSelected(): void {
    const stall = this.selected();
    if (!stall) return;
    this.stalls.update((list) => list.filter((s) => s.key !== stall.key));
    if (stall.id) {
      const id = stall.id;
      this.overrides.update((list) => withoutStall(list, id));
    }
    this.selectedKey.set(null);
  }

  /** Saves the stalls and rules set aside at the revision loaded; the server checks them. */
  protected async save(): Promise<void> {
    const view = this.view();
    if (!view || this.busy()) return;
    const number = this.selected()?.number.trim();
    this.busy.set(true);
    try {
      const saved = await firstValueFrom(
        this.api.save(
          this.slug(),
          this.eventId(),
          this.hallId(),
          planInput(view.revision, this.stalls(), this.overrides()),
        ),
      );
      this.reset(saved);
      // A stall saved for the first time has its id now: keep it selected.
      this.selectedKey.set(saved.stalls.find((s) => s.number === number)?.id ?? null);
      const open = saved.report.violations.filter((v) => !v.overridden).length;
      this.notifier.success(
        saved.report.passed ? 'Plan saved. It passes the rules.' : `Plan saved. ${open} to fix.`,
      );
    } catch (error) {
      this.refused(error);
    } finally {
      this.busy.set(false);
    }
  }

  protected async step(step: 'approve' | 'publish' | 'reopen'): Promise<void> {
    const view = this.view();
    if (!view || this.busy()) return;
    if (step === 'publish' && !(await this.confirmPublish(view))) return;
    if (step === 'reopen' && !(await this.confirmReopen(view))) return;
    this.busy.set(true);
    try {
      this.reset(
        await firstValueFrom(
          this.api[step](this.slug(), this.eventId(), this.hallId(), view.revision),
        ),
      );
      this.notifier.success(DONE[step]);
    } catch (error) {
      this.refused(error);
    } finally {
      this.busy.set(false);
    }
  }

  private confirmPublish(view: StallPlanView): Promise<boolean> {
    return this.confirm.confirm({
      title: 'Publish the plan to booking?',
      message: `Its ${view.stalls.length} stalls can then be held and booked for ${view.event.name}.`,
      confirmLabel: 'Publish',
    });
  }

  private confirmReopen(view: StallPlanView): Promise<boolean> {
    return this.confirm.confirm({
      title: 'Reopen the plan as a draft?',
      message:
        view.status === 'published'
          ? 'Its stalls stop being open for booking until it is approved and published again.'
          : 'It needs approving again after the changes.',
      confirmLabel: 'Reopen',
    });
  }

  protected async remove(): Promise<void> {
    const view = this.view();
    if (!view || this.busy()) return;
    const confirmed = await this.confirm.confirm({
      title: 'Delete this draft plan?',
      message: `The plan of ${view.hall.name} and its ${view.stalls.length} saved stalls are deleted. This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.remove(this.slug(), this.eventId(), this.hallId()));
      this.notifier.success('Draft plan deleted.');
      await this.load();
    } catch (error) {
      this.refused(error);
    } finally {
      this.busy.set(false);
    }
  }

  /** A 409 is shown with a way to reload; anything else the error interceptor has shown. */
  private refused(error: unknown): void {
    if (httpStatus(error) === 409) this.conflict.set(errorMessage(error));
  }

  protected path(g: MultiPolygon): string {
    return g
      .flatMap((poly) => poly.map((ring) => `M ${ring.map(([x, y]) => `${x} ${y}`).join(' L ')} Z`))
      .join(' ');
  }

  protected areaColor(kind: string): string {
    return (AREA_COLORS as Record<string, string>)[kind] ?? 'var(--mat-sys-outline)';
  }

  /** The open sides in words, e.g. "Bottom, Left". */
  protected sideList(sides: readonly StallSide[]): string {
    return sides.map((side) => SIDE_LABELS[side]).join(', ');
  }

  protected areaFill(a: FloorArea): string {
    return a.kind === 'outside' ? AREA_COLORS.outside : (a.color ?? AREA_COLORS[a.kind]);
  }

  /** The line of an open side: x1, y1, x2, y2. */
  protected edge(s: EditStall, side: StallSide): [number, number, number, number] {
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
