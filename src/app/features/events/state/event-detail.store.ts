import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';

import {
  AddedHalls,
  AddHallPayload,
  EventHall,
  EventDetails,
  InternalEvent,
  ItpoEventDetail,
  ItpoEventHall,
} from '../data/events.models';
import { AuthService } from '../../../core/auth/auth.service';
import { EventsApiService } from '../data/events-api.service';
import { ItpoEventsApiService } from '../data/itpo-events-api.service';

/**
 * The state of one event's page: the event with its halls, and the changes made to it. A change
 * shows at once from the API's own answer; ITPO's detail is read again in the background, so the
 * page also follows whatever ITPO holds.
 */
@Injectable()
export class EventDetailStore {
  private readonly itpo = inject(ItpoEventsApiService);
  private readonly api = inject(EventsApiService);

  private readonly auth = inject(AuthService);

  /** The event itself, as the EMS API gives it (and only to a user who may see it). */
  readonly summary = signal<EventDetails | null>(null);
  /** The event's halls, as ITPO gives them. */
  readonly event = signal<ItpoEventDetail | null>(null);
  readonly loading = signal(true);
  readonly failed = signal(false);
  readonly hallsFailed = signal(false);
  readonly halls = computed(() => this.event()?.halls ?? []);
  /** Only ITPO staff change an event, and only an internal one; any other is for reading. */
  readonly canManage = computed(() => this.auth.isStaff() && this.summary()?.kind === 'internal');

  private eventId = '';

  load(eventId: string): void {
    this.eventId = eventId;
    this.loading.set(true);
    this.failed.set(false);
    this.hallsFailed.set(false);
    this.itpo.event(eventId).subscribe({
      next: (summary) => {
        this.summary.set(summary);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.failed.set(true);
      },
    });
    this.itpo.eventWithHalls(eventId).subscribe({
      next: (event) => this.event.set(event),
      error: () => this.hallsFailed.set(true),
    });
  }

  addHalls(halls: AddHallPayload[]): Observable<AddedHalls> {
    return this.api.addHalls(this.eventId, halls).pipe(
      tap((added) => {
        this.patchHalls((current) => [...current, ...added.halls.map(toEventHall)]);
        this.refresh();
      }),
    );
  }

  removeHall(eventHallId: string): Observable<null> {
    return this.api.removeHall(this.eventId, eventHallId).pipe(
      tap(() => {
        this.patchHalls((current) => current.filter((h) => h.eventHallId !== eventHallId));
        this.refresh();
      }),
    );
  }

  /** The event's own details, after an edit. */
  applyEdit(edited: InternalEvent): void {
    this.event.update((event) =>
      event
        ? { ...event, name: edited.name, startDate: edited.startDate, endDate: edited.endDate }
        : event,
    );
  }

  private patchHalls(change: (halls: ItpoEventHall[]) => ItpoEventHall[]): void {
    this.event.update((event) => (event ? { ...event, halls: change(event.halls) } : event));
  }

  /** Reads ITPO's detail again without disturbing the page; a failure leaves what is shown. */
  private refresh(): void {
    this.itpo.event(this.eventId).subscribe({
      next: (summary) => this.summary.set(summary),
      error: () => undefined,
    });
    this.itpo.eventWithHalls(this.eventId).subscribe({
      next: (event) => this.event.set(event),
      error: () => undefined,
    });
  }
}

function toEventHall(hall: EventHall): ItpoEventHall {
  return {
    eventHallId: hall.id,
    hallId: hall.hallId,
    name: hall.name,
    forStallFnb: hall.forStallFnb,
    stallCount: 0,
    isPriceAdded: false,
    coverImage: null,
    hasLayout: false,
  };
}
