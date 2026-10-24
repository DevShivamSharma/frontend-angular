import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { catchError, map, throwError } from 'rxjs';

import { ApiError } from './api-error';
import { isApiEnvelope } from './api-envelope';

/**
 * Turns the `{ header, data }` answers into plain data, and every failure into an {@link ApiError}:
 * an envelope with `header.error`, an HTTP error (with or without an envelope), or no answer.
 * ITPO's services answer errors with HTTP 200 and the status in the header, so the header decides.
 */
export const envelopeInterceptor: HttpInterceptorFn = (req, next) =>
  next(req).pipe(
    map((event) => {
      if (event instanceof HttpResponse && isApiEnvelope(event.body)) {
        const { header, data } = event.body;
        if (header.error) {
          throw new ApiError(header.msg, header.code, data);
        }
        return event.clone({ body: data });
      }
      return event;
    }),
    catchError((error: unknown) => {
      if (error instanceof ApiError) {
        return throwError(() => error);
      }
      if (error instanceof HttpErrorResponse) {
        if (isApiEnvelope(error.error)) {
          return throwError(
            () => new ApiError(error.error.header.msg, error.error.header.code, error.error.data),
          );
        }
        const message =
          error.status === 0
            ? 'Cannot reach the server. Check your connection and try again.'
            : 'Something went wrong. Please try again.';
        return throwError(() => new ApiError(message, error.status));
      }
      return throwError(() => error);
    }),
  );
