import { HttpClient } from '@angular/common/http';
import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL } from '../api/api-base.token';
import type { Me, MembershipSummary, Session, UserView } from '../api/api.models';
import { quiet } from '../api/error-toast.interceptor';
import { httpStatus } from '../api/http-error';

/** Refresh this long before the access token expires, so requests rarely meet a 401. */
const REFRESH_LEAD_MS = 60_000;

/**
 * The signed-in user. The access token lives in memory only; the refresh token is an httpOnly
 * cookie the browser sends to /api/auth, so a reload restores the session without exposing a
 * long-lived secret to scripts.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);

  private readonly session = signal<Session | null>(null);
  private readonly membershipList = signal<MembershipSummary[]>([]);
  private refreshing: Promise<boolean> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  readonly user = computed<UserView | null>(() => this.session()?.user ?? null);
  readonly signedIn = computed(() => this.session() !== null);
  readonly memberships = this.membershipList.asReadonly();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearTimer());
  }

  accessToken(): string | null {
    return this.session()?.accessToken ?? null;
  }

  /** At startup: picks the session back up from the refresh cookie, if there is one. */
  async restore(): Promise<void> {
    await this.refresh();
  }

  async login(email: string, password: string): Promise<UserView> {
    const session = await firstValueFrom(
      this.http.post<Session>(`${this.api}/auth/login`, { email, password }),
    );
    await this.start(session);
    return session.user;
  }

  /** Accepts an invitation, signs in, and returns the slug of the organisation joined. */
  async acceptInvitation(
    token: string,
    body: { name?: string; password: string },
  ): Promise<string> {
    const session = await firstValueFrom(
      this.http.post<Session & { organisationSlug: string }>(
        `${this.api}/auth/invitations/${encodeURIComponent(token)}/accept`,
        body,
      ),
    );
    await this.start(session);
    return session.organisationSlug;
  }

  /**
   * Swaps the refresh cookie for a new access token. Concurrent callers share one request. A
   * 409 means another tab refreshed at the same moment; the cookie is already newer, so retry.
   */
  refresh(): Promise<boolean> {
    this.refreshing ??= this.doRefresh().finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  async logout(): Promise<void> {
    this.end();
    await firstValueFrom(this.http.post<void>(`${this.api}/auth/logout`, {}, quiet())).catch(
      () => undefined,
    );
  }

  /** Forgets the session locally, as when the server says it ended. */
  end(): void {
    this.clearTimer();
    this.session.set(null);
    this.membershipList.set([]);
  }

  async reloadMemberships(): Promise<void> {
    const me = await firstValueFrom(this.http.get<Me>(`${this.api}/auth/me`, quiet()));
    this.membershipList.set(me.memberships);
  }

  private async doRefresh(attempt = 0): Promise<boolean> {
    try {
      const session = await firstValueFrom(
        this.http.post<Session>(`${this.api}/auth/refresh`, {}, quiet()),
      );
      await this.start(session);
      return true;
    } catch (error) {
      if (httpStatus(error) === 409 && attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        return this.doRefresh(1);
      }
      this.end();
      return false;
    }
  }

  private async start(session: Session): Promise<void> {
    this.session.set(session);
    this.scheduleRefresh(session.expiresIn);
    await this.reloadMemberships().catch(() => this.membershipList.set([]));
  }

  private scheduleRefresh(expiresInSeconds: number): void {
    this.clearTimer();
    const delay = Math.max(expiresInSeconds * 1000 - REFRESH_LEAD_MS, 10_000);
    this.refreshTimer = setTimeout(() => void this.refresh(), delay);
  }

  private clearTimer(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}
