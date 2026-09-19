import { HttpErrorResponse } from '@angular/common/http';

/**
 * Extract a user-facing message from a failed request.
 *
 * Mirrors the React expression `e.response?.data?.message || e.message`
 * (`App.js:572`, `App.js:575-577`). Angular's `HttpErrorResponse.error` is the
 * parsed response body, which is the equivalent of axios' `response.data`.
 */
export function extractErrorMessage(e: unknown): string {
  if (e instanceof HttpErrorResponse) {
    const body = e.error as { message?: unknown } | string | null;

    if (body && typeof body === 'object' && typeof body.message === 'string' && body.message) {
      return body.message;
    }

    return e.message;
  }

  if (e instanceof Error) {
    return e.message;
  }

  return String(e);
}
