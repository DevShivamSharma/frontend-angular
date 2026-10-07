import { Pipe, PipeTransform } from '@angular/core';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "5 min ago", "3 h ago", "2 days ago", then a plain date. */
@Pipe({ name: 'timeAgo' })
export class TimeAgoPipe implements PipeTransform {
  transform(value: string | Date | null | undefined, now: number = Date.now()): string {
    if (!value) {
      return '';
    }
    const time = new Date(value).getTime();
    const elapsed = Math.max(0, now - time);
    if (elapsed < MINUTE) {
      return 'just now';
    }
    if (elapsed < HOUR) {
      return `${Math.floor(elapsed / MINUTE)} min ago`;
    }
    if (elapsed < DAY) {
      return `${Math.floor(elapsed / HOUR)} h ago`;
    }
    if (elapsed < 7 * DAY) {
      const days = Math.floor(elapsed / DAY);
      return days === 1 ? 'yesterday' : `${days} days ago`;
    }
    return new Date(time).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }
}
