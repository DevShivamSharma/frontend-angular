import { HttpErrorResponse } from '@angular/common/http';

import { errorMessage } from '../api/http-error';

/**
 * A refused publish, in words: the server's sentence, then each booked stall it names (its
 * `details`, whose first line is the sentence itself). The planner shows it whole, so whoever
 * publishes knows which stalls to put back.
 */
export function publishRefusal(error: unknown): string {
  const body =
    error instanceof HttpErrorResponse ? (error.error as { details?: unknown } | null) : null;
  const details = Array.isArray(body?.details)
    ? body.details.filter((d): d is string => typeof d === 'string')
    : [];
  return details.length ? details.join(' ') : errorMessage(error, 'The plan was not published.');
}
