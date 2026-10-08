import {
  HttpContext,
  HttpContextToken,
  HttpErrorResponse,
  HttpInterceptorFn,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';

import { Notifier } from '../ui/notifier.service';
import { API_BASE_URL } from './api-base.token';

/**
 * Statuses a call handles itself, so no toast is shown for them: `true` for every status, or a
 * list. For calls whose failure is expected and acted on, such as a guard that turns a 404
 * into the invalid-link page.
 */
export const QUIET_ERRORS = new HttpContextToken<boolean | readonly number[]>(() => false);

/** Request options for a call that handles the given statuses (all, when none are given). */
export function quiet(...statuses: number[]): { context: HttpContext } {
  return {
    context: new HttpContext().set(QUIET_ERRORS, statuses.length ? statuses : true),
  };
}

/** On the auth calls (sign in, accept an invitation, …) a 401 means wrong details: show it. */
const AUTH_CALLS = /\/auth\//;

/**
 * Shows every failed API call as a toast, with the server's message. The error still reaches
 * the caller, which only resets its own state (busy flags, reloads) and never shows it again.
 *
 * Listed before the auth interceptor, so a 401 that a session refresh recovers never shows.
 * A 401 that survives sends the user to sign in instead, except on the auth calls themselves.
 */
export const errorToastInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(inject(API_BASE_URL))) {
    return next(req);
  }
  const notifier = inject(Notifier);
  return next(req).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && shouldShow(error, req.context.get(QUIET_ERRORS))) {
        if (error.status !== 401 || AUTH_CALLS.test(req.url)) notifier.error(error);
      }
      return throwError(() => error);
    }),
  );
};

function shouldShow(error: HttpErrorResponse, quietFor: boolean | readonly number[]): boolean {
  if (quietFor === true) return false;
  return !(Array.isArray(quietFor) && quietFor.includes(error.status));
}
