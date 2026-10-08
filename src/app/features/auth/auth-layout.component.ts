import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import { PublicOrgStore } from '../../core/org/org.stores';
import { BrandMarkComponent } from '../../shared/brand-mark.component';

interface Highlight {
  icon: string;
  text: string;
}

const ORGANISATION_HIGHLIGHTS: Highlight[] = [
  { icon: 'map', text: 'Halls digitized once, reused by every event' },
  { icon: 'grid_view', text: 'Stall layouts checked against your rules' },
  { icon: 'group', text: 'Your team, each with the right access' },
];

const PLATFORM_HIGHLIGHTS: Highlight[] = [
  { icon: 'domain', text: 'Exhibition centres with their own link and look' },
  { icon: 'shield_person', text: 'Roles and permissions you decide' },
  { icon: 'history', text: 'Every administrative change on the record' },
];

/**
 * The frame of every sign-in page. On wide screens, a brand panel in the organisation's own
 * colours (or the platform's, under /admin) sits beside the form; on narrow screens only the
 * form remains, under a small logo.
 *
 * The panel is drawn from the fixed primary tones, which stay deep in light and dark alike, so
 * it reads as the same dark stage on every device while the form follows the device's theme.
 */
@Component({
  selector: 'app-auth-layout',
  imports: [MatIconModule, BrandMarkComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="auth">
      <section class="brand-panel" aria-label="About">
        <div class="brand-top rise">
          <app-brand-mark
            [name]="brandName()"
            [logoUrl]="panelLogo()"
            [size]="44"
            [showName]="false"
            class="panel-mark"
            [class.light-chip]="needsLightChip()"
          />
          <span class="panel-name">{{ brandName() }}</span>
        </div>
        <div class="pitch">
          <!-- The organisation's own mark sits inside the headline, before its name. -->
          <h2 class="rise">
            {{ pitch().lead }}
            <span class="pill" [class.light-chip]="needsLightChip()" aria-hidden="true">
              @if (org(); as o) {
                <app-brand-mark
                  [name]="o.name"
                  [logoUrl]="panelLogo()"
                  [size]="22"
                  [showName]="false"
                />
              } @else {
                <mat-icon>domain</mat-icon>
              }
            </span>
            {{ pitch().rest }}
          </h2>
          <ul class="bento">
            @for (item of highlights(); track item.icon) {
              <li class="tile rise">
                <mat-icon aria-hidden="true">{{ item.icon }}</mat-icon>
                <span>{{ item.text }}</span>
              </li>
            }
          </ul>
        </div>
        <p class="panel-foot rise">{{ org() ? 'Powered by Venue Platform' : 'Venue Platform' }}</p>
      </section>

      <section class="form-side">
        <div class="form-box">
          <div class="form-head rise">
            <app-brand-mark
              class="compact-mark"
              [name]="brandName()"
              [logoUrl]="org()?.branding?.logoUrl ?? null"
              [logoDarkUrl]="org()?.branding?.logoDarkUrl ?? null"
              [size]="40"
            />
            <h1>{{ heading() }}</h1>
            @if (subheading()) {
              <p class="muted sub">{{ subheading() }}</p>
            }
          </div>
          <div class="form-body rise">
            <ng-content />
            <ng-content select="[footer]" />
          </div>
        </div>
      </section>
    </main>
  `,
  styles: `
    .auth {
      display: grid;
      grid-template-columns: minmax(0, 7fr) minmax(360px, 5fr);
      min-height: 100dvh;
      overflow-x: clip;
      background: var(--mat-sys-surface);
    }

    /* ---- Brand panel: a deep stage, a soft glow, a fading grid and a fine grain ---- */
    .brand-panel {
      position: relative;
      isolation: isolate;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 40px;
      padding: clamp(32px, 5vh, 56px) clamp(32px, 4.5vw, 72px);
      color: var(--mat-sys-primary-fixed);
      background:
        radial-gradient(
          60% 50% at 88% 4%,
          color-mix(in srgb, var(--mat-sys-primary-fixed-dim) 30%, transparent),
          transparent 70%
        ),
        radial-gradient(
          55% 45% at 0% 100%,
          color-mix(in srgb, var(--mat-sys-tertiary-fixed-dim) 16%, transparent),
          transparent 72%
        ),
        linear-gradient(
          165deg,
          var(--mat-sys-on-primary-fixed-variant),
          var(--mat-sys-on-primary-fixed) 72%
        );
    }
    .brand-panel::before,
    .brand-panel::after {
      content: '';
      position: absolute;
      inset: 0;
      z-index: -1;
      pointer-events: none;
    }
    .brand-panel::before {
      background:
        linear-gradient(
            to right,
            color-mix(in srgb, var(--mat-sys-primary-fixed) 8%, transparent) 1px,
            transparent 1px
          )
          0 0 / 48px 48px,
        linear-gradient(
            to bottom,
            color-mix(in srgb, var(--mat-sys-primary-fixed) 8%, transparent) 1px,
            transparent 1px
          )
          0 0 / 48px 48px;
      /* Only the alpha of the mask matters; the grid fades out away from the glow. */
      mask-image: radial-gradient(
        ellipse 85% 70% at 80% 10%,
        var(--mat-sys-on-primary-fixed) 15%,
        transparent 80%
      );
    }
    /* A static grain tile (one small SVG, drawn once); the panel never scrolls. */
    .brand-panel::after {
      opacity: 0.07;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    }
    .brand-top {
      display: flex;
      align-items: center;
      gap: 14px;
      min-width: 0;
    }
    .panel-mark {
      flex: none;
      padding: 4px;
      border-radius: 14px;
      border: 1px solid color-mix(in srgb, var(--mat-sys-primary-fixed) 18%, transparent);
      background: color-mix(in srgb, var(--mat-sys-primary-fixed) 8%, transparent);
    }
    /* A logo drawn for light backgrounds keeps a light chip behind it on the dark panel. */
    .panel-mark.light-chip {
      background: var(--mat-sys-primary-fixed);
    }
    .panel-name {
      font: var(--mat-sys-title-large);
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pitch {
      display: grid;
      gap: clamp(28px, 4vh, 44px);
    }
    /* Wide and fluid: the tagline settles on two lines across desktop widths. */
    .pitch h2 {
      max-width: 20em;
      font-family: var(--app-display-font);
      font-size: clamp(28px, 2.8vw, 50px);
      font-weight: 600;
      line-height: 1.1;
      letter-spacing: -0.025em;
      text-wrap: balance;
    }
    /* The inline image: a capsule in the line of type, holding the organisation's mark. */
    .pill {
      display: inline-grid;
      place-items: center;
      box-sizing: border-box;
      min-width: 2.2em;
      height: 1.1em;
      padding: 0 0.3em;
      margin: 0 0.08em;
      vertical-align: -0.16em;
      overflow: hidden;
      border-radius: 999px;
      border: 1px solid color-mix(in srgb, var(--mat-sys-primary-fixed) 24%, transparent);
      background: color-mix(in srgb, var(--mat-sys-primary-fixed) 14%, transparent);
    }
    .pill.light-chip {
      background: var(--mat-sys-primary-fixed);
    }
    /* A wide logo widens the capsule; a monogram keeps its own small type, not the headline's. */
    .pill app-brand-mark {
      font-size: 10px;
      line-height: 1;
      letter-spacing: 0;
    }
    .pill mat-icon {
      width: auto;
      height: auto;
      font-size: 0.62em;
      line-height: 1;
    }

    /* Gapless bento: two columns, and an odd count opens with one wide tile so rows close flush. */
    .bento {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      grid-auto-flow: dense;
      gap: 12px;
      max-width: 720px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .tile {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 16px;
      padding: 20px;
      border-radius: 18px;
      border: 1px solid color-mix(in srgb, var(--mat-sys-primary-fixed) 14%, transparent);
      background: linear-gradient(
        160deg,
        color-mix(in srgb, var(--mat-sys-primary-fixed) 10%, transparent),
        color-mix(in srgb, var(--mat-sys-primary-fixed) 3%, transparent)
      );
      font: var(--mat-sys-body-large);
    }
    .tile:first-child:nth-last-child(odd) {
      grid-column: span 2;
      flex-direction: row;
      align-items: center;
      font: var(--mat-sys-title-medium);
    }
    .tile mat-icon {
      flex: none;
      width: 40px;
      height: 40px;
      font-size: 22px;
      line-height: 40px;
      text-align: center;
      border-radius: 12px;
      color: var(--mat-sys-primary-fixed);
      background: color-mix(in srgb, var(--mat-sys-primary-fixed-dim) 18%, transparent);
    }
    .panel-foot {
      margin: 0;
      font: var(--mat-sys-label-large);
      color: color-mix(in srgb, var(--mat-sys-primary-fixed) 72%, transparent);
    }

    /* ---- Form side: calm, centred ---- */
    .form-side {
      display: grid;
      place-items: center;
      padding: 48px 24px;
    }
    .form-box {
      width: min(420px, 100%);
      /* A taller primary action on every page in this frame. */
      --mat-button-filled-container-height: 48px;
    }
    .form-head {
      margin-bottom: 32px;
    }
    .compact-mark {
      display: none;
      margin-bottom: 28px;
    }
    h1 {
      font-family: var(--app-display-font);
      font-size: clamp(30px, 2.3vw, 38px);
      font-weight: 600;
      line-height: 1.15;
      letter-spacing: -0.02em;
    }
    .sub {
      margin: 10px 0 0;
      font: var(--mat-sys-body-large);
    }

    /* ---- One entrance, in a short stagger ---- */
    @keyframes rise {
      from {
        opacity: 0;
        transform: translateY(14px);
      }
    }
    .rise {
      animation: rise 440ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
    }
    .pitch h2 {
      animation-delay: 60ms;
    }
    .tile:nth-child(1) {
      animation-delay: 140ms;
    }
    .tile:nth-child(2) {
      animation-delay: 200ms;
    }
    .tile:nth-child(3) {
      animation-delay: 260ms;
    }
    .panel-foot {
      animation-delay: 320ms;
    }
    .form-head {
      animation-delay: 80ms;
    }
    .form-body {
      animation-delay: 160ms;
    }
    @media (prefers-reduced-motion: reduce) {
      .rise {
        animation: none;
      }
    }

    @media (max-width: 900px) {
      .auth {
        grid-template-columns: 1fr;
        background:
          radial-gradient(
            120% 50% at 50% 0%,
            color-mix(in srgb, var(--mat-sys-primary) 8%, transparent),
            transparent 70%
          ),
          var(--mat-sys-surface);
      }
      .brand-panel {
        display: none;
      }
      .compact-mark {
        display: inline-flex;
      }
      .form-side {
        align-items: start;
        padding-top: 48px;
      }
    }
  `,
})
export class AuthLayoutComponent {
  readonly heading = input.required<string>();
  readonly subheading = input<string>();

  protected readonly org = inject(PublicOrgStore).config;
  protected readonly brandName = computed(() => this.org()?.name ?? 'Platform administration');
  /** The tagline, split around the inline mark: "… for [mark] Bharat Mandapam". */
  protected readonly pitch = computed(() => {
    const org = this.org();
    return org
      ? { lead: 'Venue and event planning for', rest: org.name }
      : { lead: 'Run every', rest: 'exhibition centre on the platform from one place' };
  });
  protected readonly highlights = computed(() =>
    this.org() ? ORGANISATION_HIGHLIGHTS : PLATFORM_HIGHLIGHTS,
  );
  /** The panel is always dark, so the dark-surface logo comes first. */
  protected readonly panelLogo = computed(
    () => this.org()?.branding?.logoDarkUrl ?? this.org()?.branding?.logoUrl ?? null,
  );
  /** Only a logo made for light backgrounds needs one; a dark-surface logo sits on the panel. */
  protected readonly needsLightChip = computed(() => {
    const branding = this.org()?.branding;
    return !!branding?.logoUrl && !branding.logoDarkUrl;
  });
}
