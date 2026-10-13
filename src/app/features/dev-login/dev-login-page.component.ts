import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL } from '../../core/api/api-base.token';
import { quiet } from '../../core/api/error-toast.interceptor';
import { AuthService } from '../../core/auth/auth.service';
import { IconComponent } from '../../shared/icon.component';
import { InvalidLinkPageComponent } from '../invalid-link/invalid-link-page.component';

/** One account the server offers for quick login, and where it lands. */
interface DevLogin {
  email: string;
  name: string;
  organisation: { slug: string; name: string };
  role: string;
  roleKey: string;
  landing: string;
}

/** What each kind of role does, in a line, so the right card is easy to pick. */
const ROLE_HINTS: Record<string, { icon: string; tone: string; hint: string }> = {
  venue_admin: {
    icon: 'domain',
    tone: 'venue',
    hint: 'Events, halls, review and approve plans, exhibitors, bookings, settlement.',
  },
  venue_architect: { icon: 'architecture', tone: 'venue', hint: 'Draws internal layouts.' },
  organiser_admin: {
    icon: 'groups',
    tone: 'org',
    hint: 'Draws and prices its event’s stalls, sends them for approval, publishes.',
  },
  organiser_architect: { icon: 'edit', tone: 'org', hint: 'Draws its event’s stalls.' },
  exhibitor: {
    icon: 'storefront',
    tone: 'exh',
    hint: 'Portal: picks a stall on the hall map, holds it and pays.',
  },
};

/**
 * The bare domain on a local development server: one click signs in as a test account and opens
 * that role's view. The server offers this only outside production and only for the accounts in
 * its DEV_LOGIN_EMAILS; anywhere else the page is the usual invalid-link page.
 */
@Component({
  selector: 'app-dev-login-page',
  imports: [IconComponent, InvalidLinkPageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (logins() === null) {
      <main class="frame"><p class="muted">Loading…</p></main>
    } @else if (!logins()!.length) {
      <app-invalid-link-page />
    } @else {
      <main class="frame">
        <header>
          <span class="badge">Local development</span>
          <h1>Sign in as</h1>
          <p class="muted">One click signs in as the test account and opens its view.</p>
        </header>
        <ul class="cards">
          @for (l of logins(); track l.email + l.organisation.slug) {
            @let r = hint(l.roleKey);
            <li>
              <button
                type="button"
                class="card"
                [class]="'card ' + r.tone"
                [disabled]="busy() !== null"
                (click)="go(l)"
              >
                <span class="icon" aria-hidden="true"><app-icon [name]="r.icon" /></span>
                <span class="role">{{ l.role }}</span>
                <span class="org">{{ l.organisation.name }}</span>
                <span class="hint">{{ r.hint }}</span>
                <span class="who">{{ l.name }} · {{ l.email }}</span>
                <span class="cta">
                  {{ busy() === l.email + l.organisation.slug ? 'Signing in…' : 'Login as ' + l.role }}
                  <app-icon name="arrow_forward" />
                </span>
              </button>
            </li>
          }
        </ul>
        @if (error(); as e) {
          <p class="error" role="alert">{{ e }}</p>
        }
      </main>
    }
  `,
  styles: `
    .frame {
      min-height: 100dvh;
      box-sizing: border-box;
      display: grid;
      align-content: center;
      justify-items: center;
      gap: 28px;
      padding: 32px 16px;
      background: var(--app-surface-container-low);
    }
    header {
      text-align: center;
      display: grid;
      gap: 6px;
      justify-items: center;
    }
    h1 {
      margin: 0;
      font: var(--app-headline-medium);
    }
    p {
      margin: 0;
    }
    .badge {
      padding: 2px 10px;
      border-radius: 999px;
      font: var(--app-label-medium);
      background: var(--app-tertiary-container);
      color: var(--app-on-tertiary-container);
    }
    .cards {
      list-style: none;
      margin: 0;
      padding: 0;
      width: min(1040px, 100%);
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
    }
    .card {
      --c: var(--app-primary);
      width: 100%;
      height: 100%;
      display: grid;
      gap: 6px;
      align-content: start;
      text-align: left;
      padding: 20px;
      border: 1px solid var(--app-outline-variant);
      border-top: 4px solid var(--c);
      border-radius: 14px;
      background: var(--app-surface-container-lowest);
      color: var(--app-on-surface);
      font: inherit;
      cursor: pointer;
      transition:
        box-shadow 150ms ease,
        border-color 150ms ease;
    }
    .card:hover:not(:disabled),
    .card:focus-visible {
      box-shadow: var(--app-level2);
      border-color: var(--c);
    }
    .card:disabled {
      opacity: 0.6;
      cursor: progress;
    }
    .card.org {
      --c: light-dark(#7c3aed, #b48cff);
    }
    .card.exh {
      --c: light-dark(#0f8a4f, #4cc38a);
    }
    .icon {
      display: grid;
      place-items: center;
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: color-mix(in srgb, var(--c) 16%, transparent);
      color: var(--c);
      margin-bottom: 4px;
    }
    .role {
      font: var(--app-title-large);
    }
    .org {
      font: var(--app-label-large);
      color: var(--app-on-surface-variant);
    }
    .hint {
      font: var(--app-body-medium);
      color: var(--app-on-surface-variant);
      min-height: 40px;
    }
    .who {
      font: var(--app-body-small);
      color: var(--app-on-surface-variant);
      overflow-wrap: anywhere;
    }
    .cta {
      margin-top: 10px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font: var(--app-label-large);
      color: var(--c);
    }
    .error {
      color: var(--app-error);
    }
  `,
})
export class DevLoginPageComponent {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** Null while asking; empty when the server offers none (production, or none set). */
  protected readonly logins = signal<DevLogin[] | null>(null);
  protected readonly busy = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  protected hint(roleKey: string) {
    return ROLE_HINTS[roleKey] ?? { icon: 'login', tone: 'venue', hint: '' };
  }

  protected async go(l: DevLogin): Promise<void> {
    this.busy.set(l.email + l.organisation.slug);
    this.error.set(null);
    try {
      // Another account may be signed in already; start clean so its view does not linger.
      if (this.auth.signedIn()) await this.auth.logout();
      await this.auth.devLogin(l.email);
      await this.router.navigateByUrl(l.landing);
    } catch {
      this.error.set('Could not sign in as that account. Is the backend running?');
    } finally {
      this.busy.set(null);
    }
  }

  private async load(): Promise<void> {
    try {
      this.logins.set(
        await firstValueFrom(this.http.get<DevLogin[]>(`${this.api}/auth/dev-logins`, quiet())),
      );
    } catch {
      this.logins.set([]);
    }
  }
}
