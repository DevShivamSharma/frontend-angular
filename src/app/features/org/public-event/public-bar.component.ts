import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';

import { AuthService } from '../../../core/auth/auth.service';
import { PublicOrgStore } from '../../../core/org/org.stores';
import { BrandMarkComponent } from '../../../shared/brand-mark.component';

/** The top of the public event pages: whose event it is, and the way in for members. */
@Component({
  selector: 'app-public-bar',
  imports: [RouterLink, ButtonModule, BrandMarkComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (org(); as o) {
      <header class="bar">
        <a class="brand" [routerLink]="['/', o.slug]">
          <app-brand-mark
            [name]="o.name"
            [logoUrl]="o.branding.logoUrl"
            [logoDarkUrl]="o.branding.logoDarkUrl"
            [size]="32"
          />
        </a>
        @if (signedIn()) {
          <a pButton [text]="true" [routerLink]="['/', o.slug]">Open my workspace</a>
        } @else {
          <a pButton [outlined]="true" [routerLink]="['/', o.slug, 'login']">Sign in</a>
        }
      </header>
    }
  `,
  styles: `
    .bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 32px;
      border-bottom: 1px solid var(--app-outline-variant);
      background: var(--app-surface-container-lowest);
    }
    .brand {
      display: inline-flex;
      color: inherit;
      text-decoration: none;
      min-width: 0;
    }
    @media (max-width: 600px) {
      .bar {
        padding-inline: 16px;
      }
    }
  `,
})
export class PublicBarComponent {
  protected readonly org = inject(PublicOrgStore).config;
  protected readonly signedIn = inject(AuthService).signedIn;
}
