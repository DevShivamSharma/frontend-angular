import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { AuthService } from '../../../core/auth/auth.service';
import { API_CONFIG } from '../../../core/config/api-config';
import { Page } from '../../halls/data/halls.models';
import {
  EventCategory,
  EventDetails,
  EventListQuery,
  EventSummary,
  ItpoEventDetail,
  Organisation,
} from './events.models';

type Raw = Record<string, unknown>;

interface RawEventPage {
  data: Raw[];
  page: number;
  size: number;
  total: number;
}

/** ITPO's user service: the events, an event with its halls, and the organisations. */
@Injectable({ providedIn: 'root' })
export class ItpoEventsApiService {
  private readonly http = inject(HttpClient);
  private readonly url = inject(API_CONFIG).itpoUser;
  private readonly auth = inject(AuthService);

  /**
   * The events of one kind. ITPO narrows the list to the signed-in organiser's own events; ITPO
   * staff ask for all of them. Internal events carry a marker ITPO can filter on; an external one
   * has none, so those are the events that are not internal.
   */
  events(query: EventListQuery): Observable<Page<EventSummary>> {
    let params = new HttpParams().set('page', query.page).set('size', query.size);
    if (this.auth.isStaff()) {
      params = params.set('showAll', 'true');
    }
    if (query.kind === 'internal') {
      params = params.set('eventType', 'internal');
    }
    if (query.keyword) {
      params = params.set('keyword', query.keyword);
    }
    return this.http.get<RawEventPage>(`${this.url}/hall/bookings`, { params }).pipe(
      map((raw) => ({
        items: raw.data.map(toSummary).filter((event) => event.kind === query.kind),
        total: raw.total,
        page: raw.page,
        size: raw.size,
      })),
    );
  }

  /** One event's own details: what it is, whose it is, and its kind. */
  event(eventId: string): Observable<EventDetails> {
    return this.http.get<Raw>(`${this.url}/hall/event/${eventId}`).pipe(map(toEventDetails));
  }

  eventWithHalls(eventId: string): Observable<ItpoEventDetail> {
    return this.http.get<Raw>(`${this.url}/hall/event-hall-detail/${eventId}`).pipe(map(toDetail));
  }

  /** The categories the event's halls can sell: those of its product category group. */
  eventCategories(eventId: string): Observable<EventCategory[]> {
    return this.http.get<Raw[]>(`${this.url}/event/${eventId}/category`).pipe(map(toCategories));
  }

  /** The categories one hall of an event sells. */
  hallCategories(eventHallId: string): Observable<EventCategory[]> {
    return this.http
      .get<Raw[]>(`${this.url}/event/hall/${eventHallId}/category`)
      .pipe(map(toCategories));
  }

  /** Makes these the categories the hall sells; ITPO adds and takes away what differs. */
  setHallCategories(eventHallId: string, categoryIds: readonly number[]): Observable<unknown> {
    return this.http.post(`${this.url}/event/hall/${eventHallId}/map-category`, { categoryIds });
  }

  organisations(): Observable<Organisation[]> {
    return this.http
      .get<{ id: string; company_name: string }[]>(`${this.url}/organisations/getAllOrganization`)
      .pipe(
        map((raw) =>
          raw
            .map((org) => ({ id: org.id, name: org.company_name }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        ),
      );
  }
}

const toCategories = (rows: Raw[] | null): EventCategory[] =>
  (rows ?? []).map((row) => ({ id: Number(row['id']), name: String(row['name'] ?? '') }));

const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

function toSummary(raw: Raw): EventSummary {
  const org = raw['org'] as Raw | null | undefined;
  return {
    id: String(raw['id']),
    bookingId: text(raw['bookingId']),
    name: String(raw['eventName'] ?? ''),
    kind: raw['eventBookingType'] === 'internal' ? 'internal' : 'external',
    organisation: text(org?.['companyName']) ?? text(org?.['name']) ?? text(raw['organiserName']),
    bookingStatus: text(raw['bookingStatus']),
    approvalStatus: text(raw['approvalStatus']),
    startDate: text(raw['tenancyPeriodStartDate']),
    endDate: text(raw['tenancyPeriodEndDate']),
  };
}

const num = (value: unknown): number | null => {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

function toEventDetails(raw: Raw): EventDetails {
  return {
    ...toSummary(raw),
    eventType: text(raw['eventType']),
    eventFormat: text(raw['eventFormat']),
    coOrganizer: text(raw['coOrganizerName']),
    bookingDate: text(raw['bookingDate']),
    exhibitionStartDate: text(raw['exhibitionPeriodFromDate']),
    exhibitionEndDate: text(raw['exhibitionPeriodToDate']),
    startTime: text(raw['startTimeOfEvent']),
    endTime: text(raw['endTimeOfEvent']),
    expectedVisitors: num(raw['expectedNumberOfVisitor']),
    expectedExhibitors: num(raw['expectedNumberOfExhibitors']),
    businessGenerated: num(raw['businessGeneratedDuringEvent']),
    decidedBy: text(raw['bookingApproverName']) ?? text(raw['bookingRejectedByName']),
    fileNumber: text(raw['fileNumber']),
    productProfile: text(raw['productProfile']),
    specificProductProfile: text(raw['specificProductProfile']),
    specialRequest: text(raw['specialRequest']),
    description: text(raw['eventDesc']),
    remarks: text(raw['remarks']),
    productCategory: text(raw['eventCategory']),
    noOfStalls: num(raw['noOfStalls']),
    maxCategoriesForRegistration: num(raw['maxCategoriesForRegistration']),
    allowOverseasUser: flag(raw['allowOverseasUser']),
    isMarqueeEnabled: flag(raw['isMarqueeEnabled']),
    isSecondaryEnabled: flag(raw['isSecondaryCatEnabled']),
    visible: flag(raw['visibilityStatus']),
  };
}

const firstImage = (value: unknown): string | null => {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' && first.trim() ? first.trim() : null;
};

const flag = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);

function toDetail(raw: Raw): ItpoEventDetail {
  const halls = Array.isArray(raw['halls']) ? (raw['halls'] as Raw[]) : [];
  return {
    id: String(raw['id']),
    name: String(raw['eventName'] ?? ''),
    startDate: text(raw['startDate']),
    endDate: text(raw['endDate']),
    isActive: raw['isActive'] !== false,
    // An event with no halls comes back with one row of nulls from the join; it is not a hall.
    halls: halls
      .filter((hall) => hall['bookedHallId'])
      .map((hall) => ({
        eventHallId: String(hall['bookedHallId']),
        hallId: Number(hall['hallId']),
        name: String(hall['hallName'] ?? ''),
        forStallFnb: hall['forStallFnb'] === true,
        stallCount: Number(hall['stallCount'] ?? 0),
        isPriceAdded: hall['isPriceAdded'] === true,
        coverImage: firstImage(hall['coverImage']),
        hasLayout: !!hall['eventLayoutId'],
      })),
  };
}
