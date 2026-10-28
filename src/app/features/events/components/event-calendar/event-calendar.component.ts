import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { SelectButtonModule } from 'primeng/selectbutton';

import { EventSummary } from '../../data/events.models';
import { eventByline, eventLink, eventStage } from '../../domain/event-stage';

type Span = 3 | 6 | 12;

const monthStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const addMonths = (date: Date, months: number) =>
  new Date(date.getFullYear(), date.getMonth() + months, 1);
const addDays = (date: Date, days: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

/**
 * Events on a timeline of months: one row per event, its tenancy drawn as a bar coloured by its
 * stage, and a line for today. Shows 3, 6 or 12 months and steps a month at a time.
 */
@Component({
  selector: 'app-event-calendar',
  imports: [DatePipe, FormsModule, RouterLink, ButtonModule, SelectButtonModule],
  templateUrl: './event-calendar.component.html',
  styleUrl: './event-calendar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventCalendarComponent {
  readonly events = input.required<EventSummary[]>();

  protected readonly link = eventLink;
  protected readonly byline = eventByline;

  protected readonly spanOptions = [3, 6, 12].map((value) => ({ label: `${value} months`, value }));
  protected readonly span = signal<Span>(12);
  /** The first month shown, as its first day. */
  protected readonly from = signal(monthStart(new Date()));
  private readonly to = computed(() => addMonths(this.from(), this.span()));
  protected readonly lastMonth = computed(() => addMonths(this.to(), -1));

  /** Where a date falls across the shown months, in percent. */
  private readonly at = computed(() => {
    const from = this.from().getTime();
    const length = this.to().getTime() - from;
    return (date: Date) => ((date.getTime() - from) / length) * 100;
  });

  protected readonly months = computed(() =>
    Array.from({ length: this.span() }, (_, i) => {
      const start = addMonths(this.from(), i);
      return { start, width: this.at()(addMonths(start, 1)) - this.at()(start) };
    }),
  );

  protected readonly today = computed(() => {
    const at = this.at()(new Date());
    return at >= 0 && at <= 100 ? at : null;
  });

  /** The events whose tenancy overlaps the shown months, each with its bar. */
  protected readonly rows = computed(() =>
    this.events().flatMap((event) => {
      if (!event.startDate || !event.endDate) return [];
      const start = new Date(event.startDate);
      // The bar runs to the end of the last day.
      const end = addDays(new Date(event.endDate), 1);
      const left = Math.max(0, this.at()(start));
      const right = Math.min(100, this.at()(end));
      if (right <= left) return [];
      return [{ event, left, width: right - left, flip: right > 75, stage: eventStage(event) }];
    }),
  );

  protected move(months: number): void {
    this.from.update((from) => addMonths(from, months));
  }
}
