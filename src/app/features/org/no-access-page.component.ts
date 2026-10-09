import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { PublicOrgStore } from '../../core/org/org.stores';
import { AuthLayoutComponent } from '../auth/auth-layout.component';

/** Signed in, but not a member of the organisation in the link. */
@Component({
  selector: 'app-no-access-page',
  imports: [RouterLink, ButtonModule, AuthLayoutComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-auth-layout heading="No access here" [subheading]="subheading()">
      @if (auth.memberships().length) {
        <p class="muted">Your organisations:</p>
        <nav class="orgs" aria-label="Your organisations">
          @for (membership of auth.memberships(); track membership.id) {
            <a class="org" [routerLink]="['/', membership.organisation.slug]">
              <b>{{ membership.organisation.name }}</b>
              <span class="muted">{{ membership.role.name }}</span>
            </a>
          }
        </nav>
      } @else if (auth.user()?.isPlatformAdmin) {
        <a pButton [text]="true" routerLink="/admin">Go to the platform console</a>
      }
      <button pButton [outlined]="true" (click)="signOut()">Sign in with another account</button>
    </app-auth-layout>
  `,
  styles: `
    .orgs {
      display: grid;
      gap: 8px;
      margin-bottom: 16px;
    }
    .org {
      display: grid;
      gap: 2px;
      padding: 12px 14px;
      border: 1px solid var(--app-outline-variant);
      border-radius: 10px;
      color: inherit;
      text-decoration: none;
    }
    .org:hover,
    .org:focus-visible {
      border-color: var(--app-primary);
    }
  `,
})
export class NoAccessPageComponent {
  protected readonly auth = inject(AuthService);
  private readonly org = inject(PublicOrgStore).config;
  private readonly router = inject(Router);

  protected readonly subheading = computed(
    () =>
      `${this.auth.user()?.email ?? 'This account'} is not a member of ` +
      `${this.org()?.name ?? 'this organisation'}. Ask its admin for an invitation.`,
  );

  protected async signOut(): Promise<void> {
    const slug = this.org()?.slug;
    await this.auth.logout();
    await this.router.navigateByUrl(slug ? `/${slug}/login` : '/invalid-link');
  }
}
