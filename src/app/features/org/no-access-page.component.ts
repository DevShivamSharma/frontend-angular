import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { PublicOrgStore } from '../../core/org/org.stores';
import { AuthLayoutComponent } from '../auth/auth-layout.component';

/** Signed in, but not a member of the organisation in the link. */
@Component({
  selector: 'app-no-access-page',
  imports: [RouterLink, MatButtonModule, MatListModule, AuthLayoutComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-auth-layout heading="No access here" [subheading]="subheading()">
      @if (auth.memberships().length) {
        <p class="muted">Your organisations:</p>
        <mat-nav-list>
          @for (membership of auth.memberships(); track membership.id) {
            <a mat-list-item [routerLink]="['/', membership.organisation.slug]">
              <span matListItemTitle>{{ membership.organisation.name }}</span>
              <span matListItemLine>{{ membership.role.name }}</span>
            </a>
          }
        </mat-nav-list>
      } @else if (auth.user()?.isPlatformAdmin) {
        <a mat-button routerLink="/admin">Go to the platform console</a>
      }
      <button mat-stroked-button (click)="signOut()">Sign in with another account</button>
    </app-auth-layout>
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
