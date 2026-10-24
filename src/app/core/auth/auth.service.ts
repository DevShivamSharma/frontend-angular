import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  Observable,
  catchError,
  finalize,
  firstValueFrom,
  map,
  of,
  shareReplay,
  tap,
  throwError,
} from 'rxjs';

import { NotifierService } from '../notification/notifier.service';
import { AuthApiService } from './auth-api.service';
import { LoginCredentials, SessionUser, StoredSession } from './auth.models';
import { TokenStorage } from './token-storage';

/**
 * The signed-in session: who it is, the tokens, and signing in, refreshing and out. It decides
 * nothing about what a user may see (the guards do) and knows nothing about HTTP details (the
 * API service does).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(AuthApiService);
  private readonly storage = inject(TokenStorage);
  private readonly router = inject(Router);
  private readonly notifier = inject(NotifierService);

  private readonly tokens = signal<StoredSession | null>(this.storage.read());
  private readonly currentUser = signal<SessionUser | null>(null);
  private refreshing$: Observable<string> | null = null;

  readonly user = this.currentUser.asReadonly();
  readonly accessToken = computed(() => this.tokens()?.accessToken ?? null);
  readonly hasSession = computed(() => this.tokens() !== null);
  readonly isAuthenticated = computed(() => this.currentUser() !== null);
  readonly isStaff = computed(() => this.currentUser()?.type === 'itpo_staff');
  /** What to call the signed-in user: an organiser by their organisation, ITPO staff by name. */
  readonly displayName = computed(() => {
    const user = this.currentUser();
    return user ? (user.organisationName ?? user.name) : '';
  });

  /** At start-up: picks the saved session up again, and drops it if the server no longer knows it. */
  async restore(): Promise<void> {
    if (!this.hasSession()) {
      return;
    }
    try {
      this.currentUser.set(await firstValueFrom(this.api.me()));
    } catch {
      this.clear();
    }
  }

  login(credentials: LoginCredentials): Observable<SessionUser> {
    return this.api.login(credentials).pipe(
      tap((response) => {
        this.store({
          accessToken: response.accessToken,
          refreshToken: response.refreshToken,
          tokenExpires: response.tokenExpires,
        });
        this.currentUser.set(response.user);
      }),
      map((response) => response.user),
    );
  }

  /** Ends the session here and, as far as it can, on the server. */
  logout(): Observable<void> {
    const request$ = this.hasSession()
      ? this.api.logout().pipe(catchError(() => of(null)))
      : of(null);
    return request$.pipe(
      tap(() => this.clear()),
      map(() => undefined),
      finalize(() => void this.router.navigate(['/login'])),
    );
  }

  /**
   * A new access token for the same session. Several requests failing at once share one refresh.
   * A refresh that fails ends the session.
   */
  refresh(): Observable<string> {
    if (this.refreshing$) {
      return this.refreshing$;
    }
    const refreshToken = this.tokens()?.refreshToken;
    if (!refreshToken) {
      return throwError(() => new Error('No session to refresh.'));
    }

    this.refreshing$ = this.api.refresh(refreshToken).pipe(
      tap((response) => {
        this.store({
          accessToken: response.accessToken,
          refreshToken,
          tokenExpires: response.tokenExpires,
        });
        this.currentUser.set(response.user);
      }),
      map((response) => response.accessToken),
      finalize(() => (this.refreshing$ = null)),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.refreshing$;
  }

  /** The session is over (it expired, or was replaced by a sign-in elsewhere): back to the sign-in page. */
  expire(): void {
    if (!this.hasSession()) {
      return;
    }
    const returnUrl = this.router.url;
    this.clear();
    this.notifier.info('You have been signed out', 'Please sign in again to continue.');
    void this.router.navigate(
      ['/login'],
      returnUrl.startsWith('/login') ? {} : { queryParams: { returnUrl } },
    );
  }

  private store(session: StoredSession): void {
    this.tokens.set(session);
    this.storage.write(session);
  }

  private clear(): void {
    this.tokens.set(null);
    this.currentUser.set(null);
    this.storage.clear();
  }
}
