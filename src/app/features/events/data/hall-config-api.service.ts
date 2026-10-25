import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { API_CONFIG } from '../../../core/config/api-config';

/** One stall booking window of an event hall, as ITPO's stall service keeps it. */
export interface HallConfig {
  /** When stall booking opens and closes (ISO 8601); null: not limited at that end. */
  startDate: string | null;
  endDate: string | null;
  /** The most stalls one user may book; null: no limit. */
  stallCount: number | null;
  /** The most food and beverage stalls one user may book; null: no limit. */
  fnbStallCount: number | null;
  description: string | null;
  isRestrictedToApp: boolean;
}

interface RawConfig {
  stall_booking_start_date: string | null;
  stall_booking_end_date: string | null;
  no_of_stalls: number | null;
  no_of_fnb_stalls: number | null;
  description: string | null;
  is_restricted_to_app: boolean | null;
}

/**
 * The stall booking configuration of an event hall (SelfCare's "Add/Edit Config"): ITPO's stall
 * service, the same endpoints SelfCare uses, so a change is seen in both.
 */
@Injectable({ providedIn: 'root' })
export class HallConfigApiService {
  private readonly http = inject(HttpClient);
  private readonly url = `${inject(API_CONFIG).itpoStall}/hall-configuration`;

  configs(eventHallId: string): Observable<HallConfig[]> {
    return this.http
      .get<{ data: RawConfig[] | null } | null>(`${this.url}/${eventHallId}`)
      .pipe(map((answer) => (answer?.data ?? []).map(toConfig)));
  }

  /** Creates the configuration of a hall that has none. */
  create(eventId: string, eventHallId: string, configs: HallConfig[]): Observable<unknown> {
    return this.http.post(
      this.url,
      configs.map((c) => body(eventId, eventHallId, c)),
    );
  }

  /** Replaces the configuration of a hall that has one. */
  update(eventId: string, eventHallId: string, configs: HallConfig[]): Observable<unknown> {
    return this.http.patch(
      `${this.url}/${eventHallId}`,
      configs.map((c) => body(eventId, eventHallId, c)),
    );
  }

  remove(eventHallId: string): Observable<unknown> {
    return this.http.delete(`${this.url}/${eventHallId}`);
  }
}

function toConfig(raw: RawConfig): HallConfig {
  return {
    startDate: raw.stall_booking_start_date,
    endDate: raw.stall_booking_end_date,
    stallCount: raw.no_of_stalls,
    fnbStallCount: raw.no_of_fnb_stalls,
    description: raw.description,
    isRestrictedToApp: raw.is_restricted_to_app === true,
  };
}

/** The body SelfCare sends: the hall is named by its id in the event (`hallId`). */
function body(eventId: string, eventHallId: string, c: HallConfig) {
  return {
    eventId,
    hallId: eventHallId,
    startDate: c.startDate,
    endDate: c.endDate,
    stallCount: c.stallCount || null,
    description: c.description || null,
    isRestrictedToApp: c.isRestrictedToApp,
    fnbStallCount: c.fnbStallCount,
  };
}
