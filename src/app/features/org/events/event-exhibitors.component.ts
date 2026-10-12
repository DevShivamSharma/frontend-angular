import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { firstValueFrom } from 'rxjs';

import type { EventView, ExhibitorView } from '../../../core/events/events.models';
import { ExhibitorsApi } from '../../../core/events/exhibitors-api.service';
import { OrgContextStore } from '../../../core/org/org.stores';
import { ConfirmService } from '../../../core/ui/confirm.service';
import { Notifier } from '../../../core/ui/notifier.service';
import { IconComponent } from '../../../shared/icon.component';

/**
 * The exhibitors registered for an event, on the event's page: register one, or take one off
 * (not while it has bookings here; the server says so). Shown to members who see bookings; the
 * exhibitor's people then see this event too.
 */
@Component({
  selector: 'app-event-exhibitors',
  imports: [FormsModule, RouterLink, ButtonModule, SelectModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel">
      <h2 class="section-title">Exhibitors</h2>
      @if (canManage() && open()) {
        <div class="register">
          <p-select
            inputId="event-exhibitor"
            ariaLabel="Exhibitor to register"
            [options]="unregistered()"
            optionLabel="name"
            optionValue="id"
            placeholder="Choose an exhibitor"
            [ngModel]="pick()"
            (ngModelChange)="pick.set($event)"
          />
          <button pButton (click)="register()" [disabled]="!pick() || busy()">
            <app-icon name="how_to_reg" />Register
          </button>
          <a pButton [text]="true" [routerLink]="['/', slug(), 'exhibitors']">All exhibitors</a>
        </div>
      }
      <ul class="list">
        @for (x of registered(); track x.id) {
          <li>
            <span class="grow"
              ><b>{{ x.name }}</b>
              @if (x.contactName) {
                <span class="muted small"> · {{ x.contactName }}</span>
              }
            </span>
            @if (canManage() && open()) {
              <button
                pButton
                [text]="true"
                (click)="unregister(x)"
                [disabled]="busy()"
                [attr.aria-label]="'Take ' + x.name + ' off this event'"
              >
                Remove
              </button>
            }
          </li>
        } @empty {
          <li class="muted">No exhibitor is registered for this event yet.</li>
        }
      </ul>
    </section>
  `,
  styles: `
    .register {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin-bottom: 8px;
    }
    .list {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .list li {
      display: flex;
      align-items: center;
      gap: 8px;
      border-top: 1px solid var(--app-outline-variant);
      padding: 8px 0;
    }
    .list li:first-child {
      border-top: 0;
    }
    .grow {
      flex: 1 1 auto;
      min-width: 0;
    }
    .small {
      font: var(--app-body-small);
    }
  `,
})
export class EventExhibitorsComponent {
  readonly event = input.required<EventView>();

  private readonly api = inject(ExhibitorsApi);
  private readonly confirm = inject(ConfirmService);
  private readonly notifier = inject(Notifier);
  private readonly context = inject(OrgContextStore);

  protected readonly slug = this.context.slug;
  protected readonly canManage = computed(() => this.context.can('bookings.manage'));
  /** Exhibitors join or leave drafts and scheduled events only. */
  protected readonly open = computed(
    () => this.event().status === 'draft' || this.event().status === 'scheduled',
  );
  private readonly all = signal<ExhibitorView[]>([]);
  protected readonly registered = computed(() =>
    this.all().filter((x) => x.eventIds.includes(this.event().id)),
  );
  protected readonly unregistered = computed(() =>
    this.all().filter((x) => !x.eventIds.includes(this.event().id)),
  );
  protected readonly pick = signal<string | null>(null);
  protected readonly busy = signal(false);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.all.set(await firstValueFrom(this.api.list(this.slug())));
    } catch {
      // The error interceptor has shown it.
    }
  }

  protected async register(): Promise<void> {
    const x = this.unregistered().find((e) => e.id === this.pick());
    if (!x) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.register(this.slug(), this.event().id, x.id));
      this.notifier.success(`${x.name} registered for ${this.event().name}.`);
      this.pick.set(null);
      await this.load();
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
  }

  protected async unregister(x: ExhibitorView): Promise<void> {
    const ok = await this.confirm.confirm({
      title: `Take ${x.name} off ${this.event().name}?`,
      message: 'It can no longer book stalls of this event, and its people no longer see it.',
      confirmLabel: 'Take off',
      destructive: true,
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.unregister(this.slug(), this.event().id, x.id));
      this.notifier.success(`${x.name} taken off ${this.event().name}.`);
      await this.load();
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
  }
}
