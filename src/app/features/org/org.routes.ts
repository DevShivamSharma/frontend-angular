import { Routes } from '@angular/router';

import { organisationMemberGuard, permissionGuard } from '../../core/org/org.guards';

/** Everything under `/<org>/`. The organisation itself is already resolved and themed. */
export const ORG_ROUTES: Routes = [
  {
    path: 'login',
    title: 'Sign in',
    loadComponent: () => import('../auth/login-page.component').then((m) => m.LoginPageComponent),
  },
  {
    path: 'forgot-password',
    title: 'Reset password',
    loadComponent: () =>
      import('../auth/forgot-password-page.component').then((m) => m.ForgotPasswordPageComponent),
  },
  {
    path: 'reset-password',
    title: 'New password',
    loadComponent: () =>
      import('../auth/reset-password-page.component').then((m) => m.ResetPasswordPageComponent),
  },
  {
    path: 'accept-invite',
    title: 'Join',
    loadComponent: () =>
      import('../auth/accept-invite-page.component').then((m) => m.AcceptInvitePageComponent),
  },
  {
    path: 'no-access',
    title: 'No access',
    loadComponent: () => import('./no-access-page.component').then((m) => m.NoAccessPageComponent),
  },
  {
    path: '',
    canActivate: [organisationMemberGuard],
    loadComponent: () => import('./org-shell.component').then((m) => m.OrgShellComponent),
    children: [
      {
        path: '',
        pathMatch: 'full',
        title: 'Home',
        loadComponent: () =>
          import('./org-home-page.component').then((m) => m.OrgHomePageComponent),
      },
      {
        path: 'venues',
        canActivate: [permissionGuard('venues.view')],
        children: [
          {
            path: '',
            title: 'Venues',
            loadComponent: () =>
              import('./venues/venues-page.component').then((m) => m.VenuesPageComponent),
          },
          {
            path: ':venueId',
            title: 'Venue',
            loadComponent: () =>
              import('./venues/venue-page.component').then((m) => m.VenuePageComponent),
          },
          {
            path: ':venueId/import-floor-plan',
            title: 'Import floor plan',
            canActivate: [permissionGuard('halls.import')],
            loadComponent: () =>
              import('./venues/floor-plan/floor-plan-page.component').then(
                (m) => m.FloorPlanPageComponent,
              ),
          },
          {
            path: ':venueId/halls/:hallId',
            title: 'Hall',
            loadComponent: () =>
              import('./venues/hall-page.component').then((m) => m.HallPageComponent),
          },
        ],
      },
      {
        path: 'rules',
        title: 'Rules',
        canActivate: [permissionGuard('rules.view')],
        loadComponent: () =>
          import('./rules/rules-page.component').then((m) => m.RulesPageComponent),
      },
      {
        path: 'events',
        canActivate: [permissionGuard('events.view')],
        children: [
          {
            path: '',
            title: 'Events',
            loadComponent: () =>
              import('./events/events-page.component').then((m) => m.EventsPageComponent),
          },
          {
            path: ':eventId',
            title: 'Event',
            loadComponent: () =>
              import('./events/event-page.component').then((m) => m.EventPageComponent),
          },
        ],
      },
      // Pages of an event with their own permission: not under `events`, which needs events.view.
      {
        path: 'events/:eventId/halls/:hallId/plan',
        title: 'Stall plan',
        canActivate: [permissionGuard('layouts.view')],
        loadComponent: () =>
          import('./stall-plans/stall-plan-page.component').then((m) => m.StallPlanPageComponent),
      },
      {
        path: 'events/:eventId/bookings',
        title: 'Bookings',
        canActivate: [permissionGuard('bookings.view')],
        loadComponent: () =>
          import('./bookings/event-bookings-page.component').then(
            (m) => m.EventBookingsPageComponent,
          ),
      },
      {
        path: 'exhibitors',
        title: 'Exhibitors',
        canActivate: [permissionGuard('bookings.view')],
        loadComponent: () =>
          import('./exhibitors/exhibitors-page.component').then((m) => m.ExhibitorsPageComponent),
      },
      {
        path: 'portal',
        canActivate: [permissionGuard('stalls.book')],
        children: [
          {
            path: '',
            title: 'Book a stall',
            loadComponent: () =>
              import('./portal/portal-page.component').then((m) => m.PortalPageComponent),
          },
          {
            path: 'events/:eventId/halls/:hallId',
            title: 'Choose a stall',
            loadComponent: () =>
              import('./portal/portal-hall-page.component').then((m) => m.PortalHallPageComponent),
          },
        ],
      },
      {
        path: 'team',
        title: 'Team',
        canActivate: [permissionGuard('team.view')],
        loadComponent: () => import('./team/team-page.component').then((m) => m.TeamPageComponent),
      },
      {
        path: 'settings',
        title: 'Settings',
        canActivate: [permissionGuard('org.settings.view')],
        loadComponent: () =>
          import('./settings/org-settings-page.component').then((m) => m.OrgSettingsPageComponent),
      },
      {
        path: 'audit',
        title: 'Audit log',
        canActivate: [permissionGuard('audit.view')],
        loadComponent: () =>
          import('./audit/org-audit-page.component').then((m) => m.OrgAuditPageComponent),
      },
      { path: '**', redirectTo: '' },
    ],
  },
];
