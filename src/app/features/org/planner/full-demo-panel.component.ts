import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';

import { IconComponent } from '../../../shared/icon.component';
import { FullDemoService } from './full-demo.service';

/**
 * The progress of "Full demo: hall to 3D": the ten steps with where each stands, what is
 * happening now, and Pause / Resume, Next step and Stop; after an error or while the demo waits
 * for the person, Retry or Continue; at the end, what was made and the way back.
 */
@Component({
  selector: 'app-full-demo-panel',
  imports: [ButtonModule, IconComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel" aria-label="Full demo" aria-live="polite">
      <h2 class="head"><app-icon name="play" class="play" />Full demo</h2>
      <ol class="steps">
        @for (step of demo.steps(); track step.id) {
          <li
            [class]="step.status"
            [attr.aria-current]="step.status === 'running' ? 'step' : null"
            [title]="step.message"
          >
            @switch (step.status) {
              @case ('done') {
                <app-icon name="check_circle" class="mark ok" label="Done" />
              }
              @case ('running') {
                @if (demo.state() === 'error') {
                  <app-icon name="error" class="mark bad" label="Failed" />
                } @else if (demo.state() === 'waiting') {
                  <app-icon name="hourglass_empty" class="mark wait" label="Waiting for you" />
                } @else {
                  <span class="spinner" role="img" aria-label="In progress"></span>
                }
              }
              @case ('error') {
                <app-icon name="error" class="mark bad" label="Failed" />
              }
              @case ('skipped') {
                <app-icon name="remove" class="mark" label="Skipped" />
              }
              @default {
                <span class="dot" aria-hidden="true"></span>
              }
            }
            <span class="label">{{ step.label }}</span>
            @if (step.status === 'skipped') {
              <span class="tag">Skipped</span>
            }
          </li>
        }
      </ol>

      @if (demo.result(); as r) {
        <p class="note good">
          <b>“{{ r.hallName }}” is ready.</b> {{ r.zones }} zones, {{ r.booths }} booths, saved as
          version {{ r.revision }};
          @if (r.published) {
            version {{ r.published }} is published.
          } @else {
            not published.
          }
        </p>
      } @else if (demo.explanation()) {
        <p class="note" [class.bad]="demo.state() === 'error'">{{ demo.explanation() }}</p>
      }
      @if (demo.paused() && demo.working()) {
        <p class="muted small">Pausing once the current operation finishes…</p>
      }

      <div class="controls">
        @switch (demo.state()) {
          @case ('finished') {
            <button pButton type="button" (click)="demo.close()">
              <app-icon name="check" />Stay in this hall
            </button>
            @if (demo.origin(); as o) {
              <button pButton [outlined]="true" type="button" (click)="demo.backToOrigin()">
                <app-icon name="arrow_back" />Back to {{ o.name }}
              </button>
            }
          }
          @case ('error') {
            <button pButton type="button" (click)="demo.retry()">
              <app-icon name="restart_alt" />Retry
            </button>
            <button pButton [outlined]="true" severity="danger" type="button" (click)="demo.stop()">
              <app-icon name="stop" />Stop
            </button>
          }
          @case ('waiting') {
            @if (demo.waitLink(); as w) {
              <a
                pButton
                [outlined]="true"
                [routerLink]="w.link"
                [queryParams]="w.query"
                target="_blank"
                rel="noopener"
              >
                <app-icon name="open_in_new" />Open the review
              </a>
            }
            <button pButton type="button" (click)="demo.retry()">
              <app-icon name="play" />Continue
            </button>
            <button pButton [text]="true" severity="danger" type="button" (click)="demo.stop()">
              <app-icon name="stop" />Stop
            </button>
          }
          @default {
            @if (demo.paused()) {
              <button pButton [outlined]="true" type="button" (click)="demo.resume()">
                <app-icon name="play" />Resume
              </button>
            } @else {
              <button pButton [outlined]="true" type="button" (click)="demo.pause()">
                <app-icon name="pause" />Pause
              </button>
            }
            <button
              pButton
              [outlined]="true"
              type="button"
              (click)="demo.next()"
              [disabled]="demo.working()"
              [attr.title]="demo.working() ? 'Waits for the current operation to finish' : null"
            >
              <app-icon name="skip_next" />Next step
            </button>
            <button pButton [text]="true" severity="danger" type="button" (click)="demo.stop()">
              <app-icon name="stop" />Stop
            </button>
          }
        }
      </div>
    </section>
  `,
  styles: `
    .panel {
      position: absolute;
      left: 12px;
      bottom: 12px;
      z-index: 330;
      width: min(380px, calc(100% - 24px));
      max-height: calc(100% - 24px);
      overflow-y: auto;
      padding: 16px;
      border: 1px solid var(--app-outline-variant);
      border-radius: 14px;
      background: var(--app-surface, #fff);
      box-shadow: 0 6px 24px rgb(0 0 0 / 0.14);
    }
    .head {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 0 0 12px;
      font: var(--app-title-small);
      font-weight: 700;
    }
    .play {
      color: var(--app-primary);
    }
    .steps {
      display: grid;
      gap: 6px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .steps li {
      display: flex;
      align-items: center;
      gap: 10px;
      font: var(--app-body-medium);
      color: #94a3b8;
    }
    .steps li.done {
      color: #334155;
    }
    .steps li.running {
      color: #0f172a;
      font-weight: 700;
    }
    .steps li.error {
      color: var(--app-error, #dc2626);
    }
    .mark {
      flex: none;
      width: 18px;
      font-size: 1.05rem;
      text-align: center;
    }
    .ok {
      color: #16a34a;
    }
    .bad {
      color: var(--app-error, #dc2626);
    }
    .wait {
      color: #d97706;
    }
    .dot,
    .spinner {
      flex: none;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      box-sizing: border-box;
    }
    .dot {
      border: 1.5px solid #cbd5e1;
    }
    .spinner {
      border: 2px solid #e2e8f0;
      border-top-color: var(--app-primary);
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .spinner {
        animation-duration: 2.4s;
      }
    }
    .tag {
      margin-left: auto;
      font: var(--app-label-small);
      color: #94a3b8;
    }
    .note {
      margin: 14px 0 0;
      padding: 10px 12px;
      border-radius: 8px;
      background: #f1f5f9;
      color: #334155;
      font: var(--app-body-small);
    }
    .note.bad {
      background: #fef2f2;
      color: #991b1b;
    }
    .note.good {
      background: #f0fdf4;
      color: #14532d;
    }
    .small {
      margin: 6px 0 0;
      font: var(--app-body-small);
    }
    .muted {
      color: #64748b;
    }
    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 14px;
    }
    .controls :is(button, a) {
      gap: 6px;
    }
  `,
})
export class FullDemoPanelComponent {
  protected readonly demo = inject(FullDemoService);
}
