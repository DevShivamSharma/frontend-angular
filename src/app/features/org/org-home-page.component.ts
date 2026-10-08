import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { OrgContextStore, PublicOrgStore } from '../../core/org/org.stores';
import { BrandMarkComponent } from '../../shared/brand-mark.component';

interface ModuleCard {
  title: string;
  icon: string;
  text: string;
  permission: string;
}

/** What comes next, shown to the roles that will use it. */
const UPCOMING: ModuleCard[] = [
  {
    title: 'Venues and halls',
    icon: 'map',
    text: 'Manage venues and halls, draw halls by size, or import venue JSON files.',
    permission: 'venues.view',
  },
  {
    title: 'Stall layouts',
    icon: 'grid_view',
    text: 'Draft stalls with CAD tools, import an architect’s PDF, review and publish.',
    permission: 'layouts.view',
  },
  {
    title: 'Pricing',
    icon: 'sell',
    text: 'Rate cards by area, category, corner and open sides.',
    permission: 'pricing.view',
  },
  {
    title: 'Bookings',
    icon: 'confirmation_number',
    text: 'Holds, bookings and payments, in your own portal or through your system.',
    permission: 'bookings.view',
  },
];

/**
 * The hero's artwork: two blocks of stalls either side of an aisle, in the tones a stall map
 * uses. Decoration only; it shows no real stalls.
 */
type StallTone = 'free' | 'held' | 'booked' | 'own';
const STALL_ART: StallTone[][] = [
  [
    'booked',
    'free',
    'free',
    'held',
    'booked',
    'free',
    'free',
    'free',
    'own',
    'booked',
    'held',
    'free',
  ],
  [
    'free',
    'booked',
    'booked',
    'free',
    'free',
    'held',
    'booked',
    'free',
    'free',
    'free',
    'booked',
    'free',
  ],
];

@Component({
  selector: 'app-org-home-page',
  imports: [RouterLink, MatIconModule, BrandMarkComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (context.context(); as ctx) {
      <div class="page home">
        <header class="hero">
          <div class="hero-copy">
            <h1>Welcome, {{ firstName() }}</h1>
            <!-- The organisation's own mark sits in the line, before its name. -->
            <p class="lede">
              You are {{ ctx.membership.role.name }} at
              <span class="pill" aria-hidden="true">
                <app-brand-mark
                  [name]="ctx.organisation.name"
                  [logoUrl]="org()?.branding?.logoUrl ?? null"
                  [logoDarkUrl]="org()?.branding?.logoDarkUrl ?? null"
                  [size]="18"
                  [showName]="false"
                />
              </span>
              {{ ctx.organisation.name }}.
            </p>
          </div>
          <div class="hero-art" aria-hidden="true">
            @for (block of stallArt; track $index) {
              <div class="art-block">
                @for (tone of block; track $index) {
                  <span class="art-stall" [attr.data-tone]="tone"></span>
                }
              </div>
            }
          </div>
        </header>

        <!--
          Each whole card is one link. Its accessible name stays the action label it had as
          a button ("Open events"), and the description is read as the link's description.
        -->
        <div class="quick">
          @if (context.can('stalls.book') && ctx.membership.scope.exhibitorId) {
            <a
              class="tile"
              [routerLink]="['portal']"
              aria-labelledby="quick-book-action"
              aria-describedby="quick-book-text"
            >
              <span class="tile-icon"><mat-icon aria-hidden="true">add_business</mat-icon></span>
              <div class="tile-body">
                <h2>Book a stall</h2>
                <p class="muted" id="quick-book-text">
                  Your company's events, the free stalls of each hall, and your holds.
                </p>
              </div>
              <span class="tile-action" id="quick-book-action"
                >Choose a stall<mat-icon aria-hidden="true">arrow_forward</mat-icon></span
              >
            </a>
          }
          @if (context.can('events.view')) {
            <a
              class="tile"
              [routerLink]="['events']"
              aria-labelledby="quick-events-action"
              aria-describedby="quick-events-text"
            >
              <span class="tile-icon"><mat-icon aria-hidden="true">event</mat-icon></span>
              <div class="tile-body">
                <h2>Events</h2>
                <p class="muted" id="quick-events-text">
                  Events, the halls they book and their dates; internal or external.
                </p>
              </div>
              <span class="tile-action" id="quick-events-action"
                >Open events<mat-icon aria-hidden="true">arrow_forward</mat-icon></span
              >
            </a>
          }
          @if (context.can('team.view')) {
            <a
              class="tile"
              [routerLink]="['team']"
              aria-labelledby="quick-team-action"
              aria-describedby="quick-team-text"
            >
              <span class="tile-icon"><mat-icon aria-hidden="true">group</mat-icon></span>
              <div class="tile-body">
                <h2>Team</h2>
                <p class="muted" id="quick-team-text">
                  Who works here, with which role. Invite people.
                </p>
              </div>
              <span class="tile-action" id="quick-team-action"
                >Open team<mat-icon aria-hidden="true">arrow_forward</mat-icon></span
              >
            </a>
          }
          @if (context.can('org.settings.view')) {
            <a
              class="tile"
              [routerLink]="['settings']"
              aria-labelledby="quick-settings-action"
              aria-describedby="quick-settings-text"
            >
              <span class="tile-icon"><mat-icon aria-hidden="true">palette</mat-icon></span>
              <div class="tile-body">
                <h2>Branding and details</h2>
                <p class="muted" id="quick-settings-text">
                  Logo, colours, languages, invoice and email details.
                </p>
              </div>
              <span class="tile-action" id="quick-settings-action"
                >Open settings<mat-icon aria-hidden="true">arrow_forward</mat-icon></span
              >
            </a>
          }
        </div>

        @if (upcoming().length) {
          <section class="upcoming-section">
            <h2 class="section-title">Coming next</h2>
            <ul class="upcoming">
              @for (card of upcoming(); track card.title) {
                <li class="module">
                  <mat-icon aria-hidden="true">{{ card.icon }}</mat-icon>
                  <b>{{ card.title }}</b>
                  <p class="muted">{{ card.text }}</p>
                </li>
              }
            </ul>
          </section>
        }
      </div>
    }
  `,
  styles: `
    /* Chapters with room between them: hero, quick access, what comes next. */
    .home {
      gap: clamp(32px, 4.5vw, 56px);
    }

    /* ---- Hero: an editorial split, copy left and artwork right ------------------ */

    /*
     * The ambient look is gradients on the organisation's own tokens only: a soft primary
     * glow, a fainter tertiary one, and a fine grid that fades out (the ::before layer).
     */
    .hero {
      position: relative;
      isolation: isolate;
      overflow: hidden;
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      align-items: center;
      gap: 32px;
      padding: clamp(28px, 5vw, 64px) clamp(20px, 4vw, 56px);
      border-radius: 24px;
      border: 1px solid var(--mat-sys-outline-variant);
      background:
        radial-gradient(
          ellipse 60% 130% at 0% 0%,
          color-mix(in srgb, var(--mat-sys-primary) 16%, transparent),
          transparent 70%
        ),
        radial-gradient(
          ellipse 45% 110% at 100% 100%,
          color-mix(in srgb, var(--mat-sys-tertiary) 10%, transparent),
          transparent 70%
        ),
        var(--mat-sys-surface-container-lowest);
    }
    .hero::before {
      content: '';
      position: absolute;
      inset: 0;
      z-index: -1;
      pointer-events: none;
      background:
        linear-gradient(
            to right,
            color-mix(in srgb, var(--mat-sys-outline-variant) 55%, transparent) 1px,
            transparent 1px
          )
          0 0 / 32px 32px,
        linear-gradient(
            to bottom,
            color-mix(in srgb, var(--mat-sys-outline-variant) 55%, transparent) 1px,
            transparent 1px
          )
          0 0 / 32px 32px;
      mask-image: radial-gradient(
        ellipse 70% 100% at 20% 0%,
        var(--mat-sys-on-surface),
        transparent 75%
      );
    }
    @media (min-width: 1000px) {
      .hero {
        grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
        gap: clamp(40px, 6vw, 96px);
      }
    }
    /* Wide and fluid: the greeting stays on one or two lines at every desktop width. */
    h1 {
      font-family: var(--app-display-font);
      font-size: clamp(2.25rem, 1.4rem + 2.8vw, 3.75rem);
      font-weight: 600;
      line-height: 1.05;
      letter-spacing: -0.03em;
      text-wrap: balance;
      overflow-wrap: anywhere;
    }
    .lede {
      margin: 16px 0 0;
      max-width: 64ch;
      font: var(--mat-sys-body-large);
      color: var(--mat-sys-on-surface-variant);
    }
    /* The inline image: a capsule in the line of text, holding the organisation's mark. */
    .pill {
      display: inline-grid;
      place-items: center;
      box-sizing: border-box;
      min-width: 2.4em;
      height: 1.6em;
      padding: 0 0.35em;
      margin: 0 0.15em;
      vertical-align: middle;
      overflow: hidden;
      border-radius: 999px;
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface-container-high);
    }
    /* A monogram keeps its own small type. */
    .pill app-brand-mark {
      font-size: 9px;
      line-height: 1;
    }

    /* The artwork: two blocks of stalls and an aisle, in stall-map tones. */
    .hero-art {
      display: none;
    }
    @media (min-width: 1000px) {
      .hero-art {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 22px;
        justify-self: end;
        width: min(100%, 360px);
        animation: art-in 640ms cubic-bezier(0.2, 0, 0, 1) 120ms backwards;
      }
    }
    .art-block {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
    }
    .art-stall {
      aspect-ratio: 4 / 3;
      border-radius: 6px;
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface-container-high);
    }
    .art-stall[data-tone='held'] {
      border-color: transparent;
      background: var(--mat-sys-tertiary-container);
    }
    .art-stall[data-tone='booked'] {
      border-color: transparent;
      background: var(--mat-sys-primary-container);
    }
    .art-stall[data-tone='own'] {
      border-color: transparent;
      background: var(--mat-sys-primary);
    }

    /* ---- Quick access: a gapless bento ------------------------------------------ */

    /*
     * The cards are permission-gated, so 0 to 4 can show. The spans below are chosen from
     * the visible count with "quantity queries": ":first-child:nth-last-child(n)" matches the
     * first card only when there are exactly n cards. Every count fills its rows exactly.
     */
    .quick {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      grid-auto-flow: dense;
      gap: 16px;
      /* The cards rise one by one themselves; the grid does not rise as well. */
      animation: none;
    }
    .quick:empty {
      display: none;
    }
    /* Tablet: two columns. With an odd count the first card takes the whole first row. */
    @media (min-width: 600px) and (max-width: 1199.98px) {
      .quick {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .tile:first-child:nth-last-child(odd) {
        grid-column: 1 / -1;
      }
    }
    /* Desktop: six columns. 1: 6 | 2: 4+2 | 3: 2+2+2 | 4: 4+2, 2+4 | 5: 4+2, 2+2+2. */
    @media (min-width: 1200px) {
      .quick {
        grid-template-columns: repeat(6, minmax(0, 1fr));
      }
      .tile {
        grid-column: span 2;
      }
      .tile:only-child {
        grid-column: 1 / -1;
      }
      .tile:first-child:nth-last-child(2),
      .tile:first-child:nth-last-child(4),
      .tile:first-child:nth-last-child(4) ~ .tile:last-child,
      .tile:first-child:nth-last-child(5) {
        grid-column: span 4;
      }
    }

    .tile {
      position: relative;
      isolation: isolate;
      overflow: hidden;
      display: grid;
      grid-template-rows: auto 1fr auto;
      gap: 16px;
      min-height: 200px;
      box-sizing: border-box;
      padding: 24px;
      border-radius: 16px;
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface-container-lowest);
      color: var(--mat-sys-on-surface);
      text-decoration: none;
      transition:
        transform 180ms ease-out,
        border-color 180ms ease-out,
        box-shadow 180ms ease-out;
    }
    /* Hover physics: a glow that swells slowly from the corner (transform and opacity only). */
    .tile::after {
      content: '';
      position: absolute;
      top: -35%;
      right: -25%;
      width: 75%;
      aspect-ratio: 1;
      z-index: -1;
      pointer-events: none;
      border-radius: 50%;
      background: radial-gradient(
        closest-side,
        color-mix(in srgb, var(--mat-sys-primary) 14%, transparent),
        transparent
      );
      opacity: 0;
      transform: scale(0.8);
      transition:
        opacity 500ms ease-out,
        transform 700ms ease-out;
    }
    /* The first card leads: a faint glow, and the one filled action of the page. */
    .tile:first-child {
      background:
        radial-gradient(
          ellipse 90% 120% at 100% 0%,
          color-mix(in srgb, var(--mat-sys-primary) 9%, transparent),
          transparent 65%
        ),
        var(--mat-sys-surface-container-lowest);
    }
    .tile:hover,
    .tile:focus-visible {
      transform: translateY(-2px);
      border-color: color-mix(in srgb, var(--mat-sys-primary) 45%, var(--mat-sys-outline-variant));
      box-shadow: var(--mat-sys-level2);
    }
    .tile:hover::after,
    .tile:focus-visible::after {
      opacity: 1;
      transform: scale(1.05);
    }
    .tile:focus-visible {
      outline: 2px solid var(--mat-sys-primary);
      outline-offset: 2px;
    }
    .tile-icon {
      display: inline-grid;
      place-items: center;
      justify-self: start;
      width: 44px;
      height: 44px;
      border-radius: 12px;
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
      transition: transform 700ms ease-out;
    }
    .tile:hover .tile-icon,
    .tile:focus-visible .tile-icon {
      transform: scale(1.06);
    }
    .tile h2 {
      font-family: var(--app-display-font);
      font-size: 1.375rem;
      font-weight: 600;
      line-height: 1.2;
      letter-spacing: -0.015em;
    }
    .tile p {
      margin: 6px 0 0;
      max-width: 52ch;
    }
    .tile-action {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      justify-self: start;
      font: var(--mat-sys-label-large);
      color: var(--mat-sys-primary);
      white-space: nowrap;
    }
    .tile-action mat-icon {
      width: 18px;
      height: 18px;
      font-size: 18px;
      transition: transform 180ms ease-out;
    }
    .tile:hover .tile-action mat-icon,
    .tile:focus-visible .tile-action mat-icon {
      transform: translateX(3px);
    }
    .tile:first-child .tile-action {
      padding: 8px 16px;
      border-radius: 8px;
      background: var(--mat-sys-primary);
      color: var(--mat-sys-on-primary);
    }
    /* A lone card lies flat across the row: icon, text, action. */
    @media (min-width: 600px) {
      .tile:only-child {
        grid-template-columns: auto minmax(0, 1fr) auto;
        grid-template-rows: none;
        align-items: center;
        gap: 20px;
        min-height: 0;
      }
    }

    /* ---- Coming next: a quiet list ----------------------------------------------- */

    .upcoming {
      list-style: none;
      margin: 0;
      padding: 0;
      border-top: 1px solid var(--mat-sys-outline-variant);
    }
    .module {
      display: grid;
      grid-template-columns: 24px minmax(0, 1fr);
      column-gap: 16px;
      row-gap: 2px;
      align-items: baseline;
      padding: 14px 4px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .module mat-icon {
      grid-row: span 2;
      align-self: center;
      color: var(--mat-sys-on-surface-variant);
    }
    .module b {
      font: var(--mat-sys-title-small);
    }
    .module p {
      margin: 0;
    }
    @media (min-width: 900px) {
      .module {
        grid-template-columns: 24px 200px minmax(0, 1fr);
      }
      .module mat-icon {
        grid-row: auto;
      }
    }

    /* ---- Entrance: once, short, staggered ----------------------------------------- */

    /*
     * "backwards" holds the first frame during the delay, then lets go once the entrance
     * ends, so the hover lift (also a transform) still works afterwards.
     */
    @keyframes rise {
      from {
        opacity: 0;
        transform: translateY(12px);
      }
    }
    /* The artwork grows into place and brightens, once. */
    @keyframes art-in {
      from {
        opacity: 0;
        transform: scale(0.94);
      }
    }
    .hero,
    .tile,
    .upcoming-section {
      animation: rise 420ms cubic-bezier(0.2, 0, 0, 1) backwards;
    }
    .tile:nth-child(1) {
      animation-delay: 80ms;
    }
    .tile:nth-child(2) {
      animation-delay: 140ms;
    }
    .tile:nth-child(3) {
      animation-delay: 200ms;
    }
    .tile:nth-child(4) {
      animation-delay: 260ms;
    }
    .upcoming-section {
      animation-delay: 320ms;
    }

    @media (prefers-reduced-motion: reduce) {
      .hero,
      .hero-art,
      .tile,
      .upcoming-section {
        animation: none;
      }
      .tile,
      .tile::after,
      .tile-icon,
      .tile-action mat-icon {
        transition: none;
      }
      .tile:hover,
      .tile:focus-visible,
      .tile:hover .tile-icon,
      .tile:focus-visible .tile-icon,
      .tile:hover .tile-action mat-icon,
      .tile:focus-visible .tile-action mat-icon {
        transform: none;
      }
    }
  `,
})
export class OrgHomePageComponent {
  protected readonly context = inject(OrgContextStore);
  protected readonly org = inject(PublicOrgStore).config;
  private readonly user = inject(AuthService).user;

  protected readonly stallArt = STALL_ART;
  protected readonly firstName = computed(() => this.user()?.name.split(' ')[0] ?? '');
  protected readonly upcoming = computed(() =>
    UPCOMING.filter((card) => this.context.can(card.permission)),
  );
}
