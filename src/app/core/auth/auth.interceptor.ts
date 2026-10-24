import { HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';

import { ApiError } from '../http/api-error';
import { SKIP_AUTH } from './auth-api.service';
import { AuthService } from './auth.service';

/**
 * Adds the access token to every request, and when an API answers 401 refreshes it once and
 * repeats the request. If the refresh fails too, the session is over.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.context.get(SKIP_AUTH)) {
    return next(req);
  }

  const auth = inject(AuthService);
  const withToken = (request: HttpRequest<unknown>) => {
    const token = auth.accessToken();
    return token ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : request;
  };

  return next(withToken(req)).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof ApiError) || !error.isUnauthorised || !auth.hasSession()) {
        return throwError(() => error);
      }
      return auth.refresh().pipe(
        switchMap(() => next(withToken(req))),
        catchError(() => {
          auth.expire();
          return throwError(() => error);
        }),
      );
    }),
  );
};
