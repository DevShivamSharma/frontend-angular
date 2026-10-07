import { HttpErrorResponse } from '@angular/common/http';

/** The API's error body: one sentence meant for the user. */
interface ApiErrorBody {
  status?: number;
  message?: unknown;
}

/** A message to show for a failed call. */
export function errorMessage(
  error: unknown,
  fallback = 'Something went wrong. Please try again.',
): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) {
      return 'The server cannot be reached. Check your connection and try again.';
    }
    const body = error.error as ApiErrorBody | null;
    if (body && typeof body.message === 'string' && body.message) {
      return body.message;
    }
    return fallback;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

export function httpStatus(error: unknown): number | null {
  return error instanceof HttpErrorResponse ? error.status : null;
}
