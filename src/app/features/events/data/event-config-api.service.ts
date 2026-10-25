import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../../../core/config/api-config';

/**
 * An event's stall booking configuration as ITPO's user service keeps it (SelfCare's "Add/Update
 * Event Configuration"). Field names are ITPO's own: the same record is read by SelfCare.
 */
export interface EventConfigRecord {
  id: string;
  eventCategory: string | null;
  noOfStalls: number | null;
  maxCategoriesForRegistration: number | null;
  isSecondaryCatEnabled: boolean | null;
  isMarqueeEnabled: boolean | null;
  stall_booking_start_date: string | null;
  stall_booking_end_date: string | null;
  challan_last_date: string | null;
  marquee_registration_date: string | null;
  marquee_booking_end_date: string | null;
  marquees_booking_start_date: string | null;
  marquees_booking_end_date: string | null;
  marquee_registeration_info: string | null;
  show_fnb_option: boolean | null;
  fnb_register_start_date: string | null;
  fnb_register_end_date: string | null;
  fnb_booking_start_date: string | null;
  fnb_booking_end_date: string | null;
  fnb_registeration_info: string | null;
  fnb_enable_sequerty: boolean | null;
  fnb_type: string | null;
  fnb_sequerty_value: number | null;
  branding_booking_start_date: string | null;
  branding_booking_end_date: string | null;
  led_booking_start_date: string | null;
  led_booking_end_date: string | null;
  sponsor_booking_start_date: string | null;
  sponsor_booking_end_date: string | null;
  show_led_option: boolean | null;
  show_sponsor_option: boolean | null;
  show_branding_option: boolean | null;
  show_service_event: boolean | null;
  show_allotment_letter: boolean | null;
  show_material_entry: boolean | null;
  show_material_exit: boolean | null;
  sponsor_pdf_link: string | null;
  branding_pdf_link: string | null;
  cart_timer_minutes: number | null;
}

/** The body ITPO takes; dates are ISO text, and a field left out stays as it is. */
export type EventConfigBody = Record<string, unknown>;

/** ITPO's user service: `hall/marquee-stall-dates`, the endpoints SelfCare uses. */
@Injectable({ providedIn: 'root' })
export class EventConfigApiService {
  private readonly http = inject(HttpClient);
  private readonly url = `${inject(API_CONFIG).itpoUser}/hall/marquee-stall-dates`;

  /** The configuration of an event; null while it has none. */
  get(eventId: string): Observable<EventConfigRecord | null> {
    return this.http.get<EventConfigRecord | null>(`${this.url}/${eventId}`);
  }

  create(body: EventConfigBody): Observable<unknown> {
    return this.http.post(this.url, body);
  }

  /** `id` is the configuration's own id (not the event's), as SelfCare sends it. */
  update(id: string, body: EventConfigBody): Observable<unknown> {
    return this.http.put(`${this.url}/${id}`, body);
  }
}
