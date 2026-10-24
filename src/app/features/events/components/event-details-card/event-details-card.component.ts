import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { plainText } from '../../../../shared/utils/text.util';
import { EventDetails } from '../../data/events.models';

/**
 * The details of an event, in three groups (who and what, when, how many) and the longer texts its
 * organiser wrote. The name, booking id and statuses are in the page header, so not repeated here.
 */
@Component({
  selector: 'app-event-details-card',
  imports: [DatePipe, DecimalPipe],
  templateUrl: './event-details-card.component.html',
  styleUrl: './event-details-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventDetailsCardComponent {
  readonly event = input.required<EventDetails>();

  protected readonly notes = computed(() => {
    const event = this.event();
    return [
      { label: 'Product profile', text: plainText(event.productProfile) },
      { label: 'Specific product profile', text: plainText(event.specificProductProfile) },
      { label: 'Special request', text: plainText(event.specialRequest) },
      { label: 'Event description', text: plainText(event.description) },
      { label: 'Remarks', text: plainText(event.remarks) },
    ].filter((note) => note.text);
  });

  protected readonly hours = computed(() => {
    const { startTime, endTime } = this.event();
    const start = startTime?.slice(0, 5);
    const end = endTime?.slice(0, 5);
    return start && end ? `${start} – ${end}` : (start ?? end ?? null);
  });
}
