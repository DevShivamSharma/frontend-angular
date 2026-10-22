import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { SelectModule } from 'primeng/select';
import { firstValueFrom } from 'rxjs';

import { EventsApi } from '../../../core/events/events-api.service';
import type { ItpoHallView } from '../../../core/events/itpo-events.models';
import { dialogData, DialogRef } from '../../../core/ui/app-dialog.service';
import { FieldComponent } from '../../../shared/field.component';
import { IconComponent } from '../../../shared/icon.component';

export interface ItpoAddHallData {
  slug: string;
  /** ITPO's id of the internal event. */
  itpoEventId: string;
  eventName: string;
}

/**
 * Adds one of ITPO's halls to an internal event, as SelfCare does: the halls with a floor to
 * plan on, less those the event has. Closes with `true` once added.
 */
@Component({
  selector: 'app-itpo-add-hall-dialog',
  imports: [FormsModule, ButtonModule, CheckboxModule, SelectModule, FieldComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="dialog-title">Add a hall to {{ data.eventName }}</h2>
    <div class="dialog-content">
      <p class="muted">
        The hall is added to the event in ITPO's records, with its floor from ITPO, ready to plan.
      </p>
      <app-field label="Hall" for="itpo-hall">
        <p-select
          inputId="itpo-hall"
          [options]="free()"
          optionLabel="name"
          optionValue="id"
          [ngModel]="hallId()"
          (ngModelChange)="pick($event)"
          [filter]="true"
          filterBy="name"
          [loading]="loading()"
          placeholder="Choose a hall"
          appendTo="body"
        />
      </app-field>
      <label class="check">
        <p-checkbox [binary]="true" [ngModel]="fnb()" (ngModelChange)="fnb.set($event)" />
        Food &amp; beverage stalls in this hall
      </label>
      @if (!loading() && !free().length) {
        <p class="muted"><app-icon name="info" /> Every hall with a floor is in this event.</p>
      }
    </div>
    <div class="dialog-actions">
      <button pButton [text]="true" type="button" (click)="ref.close()">Cancel</button>
      <button pButton type="button" (click)="add()" [disabled]="!hallId() || busy()">
        Add hall
      </button>
    </div>
  `,
  styles: `
    .muted {
      margin: 0 0 12px;
      color: var(--app-on-surface-variant);
    }
    .check {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-top: 12px;
    }
    :host ::ng-deep .p-select {
      width: 100%;
    }
  `,
})
export class ItpoAddHallDialogComponent {
  protected readonly data = dialogData<ItpoAddHallData>();
  protected readonly ref = inject(DialogRef);
  private readonly api = inject(EventsApi);

  private readonly halls = signal<ItpoHallView[]>([]);
  private readonly taken = signal<Set<string>>(new Set());
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly hallId = signal<string | null>(null);
  protected readonly fnb = signal(false);
  protected readonly free = computed(() => this.halls().filter((h) => !this.taken().has(h.id)));

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const [halls, event] = await Promise.all([
        firstValueFrom(this.api.itpoHalls(this.data.slug)),
        firstValueFrom(this.api.itpoEvent(this.data.slug, this.data.itpoEventId)),
      ]);
      this.halls.set(halls);
      this.taken.set(new Set(event.eventHalls.map((h) => h.hallId)));
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.loading.set(false);
    }
  }

  /** A hall ITPO keeps for food & beverage stalls starts ticked. */
  protected pick(id: string): void {
    this.hallId.set(id);
    this.fnb.set(this.halls().find((h) => h.id === id)?.forStallFnb ?? false);
  }

  protected async add(): Promise<void> {
    const hallId = this.hallId();
    if (!hallId) return;
    this.busy.set(true);
    try {
      await firstValueFrom(
        this.api.addItpoHall(this.data.slug, this.data.itpoEventId, hallId, this.fnb()),
      );
      this.ref.close(true);
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
  }
}
