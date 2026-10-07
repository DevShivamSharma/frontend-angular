import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, from, switchMap, throwError } from 'rxjs';

import { API_BASE_URL } from '../api/api-base.token';
import { AuthService } from './auth.service';

/** Auth calls that read or set the refresh cookie, and carry no bearer token. */
const COOKIE_CALLS = /\/auth\/(login|refresh|logout|invitations\/[^/]+\/accept)$/;

/**
 * Adds the access token to API calls, and on a 401 refreshes the session once and retries.
 * When the session cannot be refreshed, sends the user to the sign-in page they belong to.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const api = inject(API_BASE_URL);
  if (!req.url.startsWith(api)) {
    return next(req);
  }

  const auth = inject(AuthService);
  const router = inject(Router);

  if (COOKIE_CALLS.test(req.url)) {
    return next(req.clone({ withCredentials: true }));
  }

  const token = auth.accessToken();
  const withToken = (request: HttpRequest<unknown>, value: string | null) =>
    value ? request.clone({ setHeaders: { Authorization: `Bearer ${value}` } }) : request;

  return next(withToken(req, token)).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401 || !token) {
        return throwError(() => error);
      }
      return from(auth.refresh()).pipe(
        switchMap((refreshed) => {
          if (!refreshed) {
            void router.navigateByUrl(signInUrl(router.url), { replaceUrl: true });
            return throwError(() => error);
          }
          return next(withToken(req, auth.accessToken()));
        }),
      );
    }),
  );
};

/** `/admin/...` signs in at /admin/login; `/<org>/...` at its own branded page. */
export function signInUrl(currentUrl: string): string {
  const [first] = currentUrl.split(/[/?#]/).filter(Boolean);
  if (!first || first === 'admin' || first === 'invalid-link') {
    return `/admin/login?returnUrl=${encodeURIComponent(currentUrl)}`;
  }
  return `/${first}/login?returnUrl=${encodeURIComponent(currentUrl)}`;
}
