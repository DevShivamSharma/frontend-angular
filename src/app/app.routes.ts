import { isDevMode } from '@angular/core';
import { Routes } from '@angular/router';

import { organisationGuard, platformThemeGuard } from './core/org/org.guards';
import { environment } from '../environments/environment';

const invalidLink = () =>
  import('./features/invalid-link/invalid-link-page.component').then(
    (m) => m.InvalidLinkPageComponent,
  );

/**
 * ITPO's app: the bare domain opens `/itpo`, ITPO's app in its own look. `/admin` is the
 * platform console; a path naming no organisation is the invalid-link page, which lists nothing.
 */
export const routes: Routes = [
  {
    // The app is ITPO's: the bare domain opens it.
    path: '',
    pathMatch: 'full',
    redirectTo: environment.organisation,
  },
  {
    path: 'dev-login',
    title: () => (isDevMode() ? 'Quick sign-in' : 'Invalid link'),
    canActivate: [platformThemeGuard],
    // A development build offers quick sign-in here (only if the server allows it); a
    // production build never ships that page.
    loadComponent: () =>
      isDevMode()
        ? import('./features/dev-login/dev-login-page.component').then(
            (m) => m.DevLoginPageComponent,
          )
        : invalidLink(),
  },
  {
    path: 'invalid-link',
    title: 'Invalid link',
    canActivate: [platformThemeGuard],
    loadComponent: invalidLink,
  },
  {
    path: 'admin',
    canActivate: [platformThemeGuard],
    loadChildren: () => import('./features/admin/admin.routes').then((m) => m.ADMIN_ROUTES),
  },
  {
    path: ':org',
    canActivate: [organisationGuard],
    loadChildren: () => import('./features/org/org.routes').then((m) => m.ORG_ROUTES),
  },
  {
    path: '**',
    title: 'Invalid link',
    canActivate: [platformThemeGuard],
    loadComponent: invalidLink,
  },
];
