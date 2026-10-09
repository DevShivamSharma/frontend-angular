import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { IconComponent } from '../../shared/icon.component';

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
 */
@Component({
  selector: 'app-auth-layout',
  imports: [IconComponent, BrandMarkComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="auth">
      <section class="brand-panel" aria-label="About">
        <div class="brand-top">
          <app-brand-mark
            [name]="brandName()"
            [logoUrl]="org()?.branding?.logoDarkUrl ?? org()?.branding?.logoUrl ?? null"
            [size]="48"
            [showName]="false"
            class="panel-mark"
          />
          <span class="panel-name">{{ brandName() }}</span>
        </div>
        <div class="pitch">
          <h2>{{ tagline() }}</h2>
          <ul>
            @for (item of highlights(); track item.icon) {
              <li><app-icon [name]="item.icon" />{{ item.text }}</li>
            }
          </ul>
        </div>
        <p class="panel-foot">{{ org() ? 'Powered by Venue Platform' : 'Venue Platform' }}</p>
      </section>

      <section class="form-side">
        <div class="form-box">
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
          <ng-content />
          <ng-content select="[footer]" />
        </div>
      </section>
    </main>
  `,
  styles: `
    .auth {
      display: grid;
      grid-template-columns: minmax(360px, 5fr) 6fr;
      min-height: 100dvh;
      background: var(--app-surface);
    }
    .brand-panel {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 32px;
      padding: 40px 48px;
      color: var(--app-on-primary);
      background:
        repeating-linear-gradient(
          90deg,
          transparent 0 39px,
          color-mix(in srgb, var(--app-on-primary) 9%, transparent) 39px 40px
        ),
        repeating-linear-gradient(
          0deg,
          transparent 0 39px,
          color-mix(in srgb, var(--app-on-primary) 9%, transparent) 39px 40px
        ),
        linear-gradient(
          150deg,
          var(--app-primary),
          color-mix(in srgb, var(--app-primary) 55%, var(--app-tertiary))
        );
    }
    .brand-top {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .panel-mark {
      padding: 4px;
      border-radius: 16px;
      background: color-mix(in srgb, var(--app-on-primary) 92%, transparent);
    }
    .panel-name {
      font: var(--app-title-large);
    }
    .pitch h2 {
      max-width: 440px;
      font: var(--app-headline-medium);
      font-weight: 600;
    }
    .pitch ul {
      display: grid;
      gap: 14px;
      margin: 28px 0 0;
      padding: 0;
      list-style: none;
    }
    .pitch li {
      display: flex;
      align-items: center;
      gap: 12px;
      font: var(--app-body-large);
    }
    .pitch app-icon {
      flex: none;
      display: grid;
      place-items: center;
      width: 36px;
      height: 36px;
      font-size: 20px;
      line-height: 36px;
      text-align: center;
      border-radius: 10px;
      background: color-mix(in srgb, var(--app-on-primary) 16%, transparent);
    }
    .panel-foot {
      margin: 0;
      font: var(--app-label-medium);
      opacity: 0.85;
    }
    .form-side {
      display: grid;
      place-items: center;
      padding: 32px 24px;
    }
    .form-box {
      width: min(400px, 100%);
    }
    .compact-mark {
      display: none;
      margin-bottom: 24px;
    }
    h1 {
      font: var(--app-headline-small);
    }
    .sub {
      margin: 8px 0 24px;
    }
    @media (max-width: 900px) {
      .auth {
        grid-template-columns: 1fr;
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
  protected readonly tagline = computed(() =>
    this.org()
      ? `Venue and event planning for ${this.org()!.name}`
      : 'Run every exhibition centre on the platform from one place',
  );
  protected readonly highlights = computed(() =>
    this.org() ? ORGANISATION_HIGHLIGHTS : PLATFORM_HIGHLIGHTS,
  );
}
