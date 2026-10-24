import { HttpClient, HttpContext, HttpContextToken, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../config/api-config';
import { LoginCredentials, LoginResponse, RefreshResponse, SessionUser } from './auth.models';

/** Marks a request the auth interceptor must leave alone (no token added, no refresh on a 401). */
export const SKIP_AUTH = new HttpContextToken<boolean>(() => false);

/** The auth endpoints of the EMS API, and nothing else. */
@Injectable({ providedIn: 'root' })
export class AuthApiService {
  private readonly http = inject(HttpClient);
  private readonly url = `${inject(API_CONFIG).ems}/auth`;

  login(credentials: LoginCredentials): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${this.url}/login`, credentials, {
      context: new HttpContext().set(SKIP_AUTH, true),
    });
  }

  /** The refresh token goes as the bearer token. */
  refresh(refreshToken: string): Observable<RefreshResponse> {
    return this.http.post<RefreshResponse>(`${this.url}/refresh`, null, {
      headers: new HttpHeaders({ Authorization: `Bearer ${refreshToken}` }),
      context: new HttpContext().set(SKIP_AUTH, true),
    });
  }

  me(): Observable<SessionUser> {
    return this.http.get<SessionUser>(`${this.url}/me`);
  }

  logout(): Observable<null> {
    return this.http.post<null>(`${this.url}/logout`, null);
  }
}
