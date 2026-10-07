import { Routes } from '@angular/router';

import { organisationGuard, platformThemeGuard } from './core/org/org.guards';

const invalidLink = () =>
  import('./features/invalid-link/invalid-link-page.component').then(
    (m) => m.InvalidLinkPageComponent,
  );

/**
 * One domain for every organisation: `/<org>/...` is that organisation's app in its own look,
 * `/admin` is the platform console, and anything that names no organisation (the bare domain
 * included) is the invalid-link page, which lists nothing.
 */
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Invalid link',
    canActivate: [platformThemeGuard],
    loadComponent: invalidLink,
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
