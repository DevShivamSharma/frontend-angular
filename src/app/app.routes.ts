import { inject } from '@angular/core';
import { Routes } from '@angular/router';

import { AuthService } from './core/auth/auth.service';
import { authGuard, guestGuard, staffGuard } from './core/auth/auth.guard';
import { unsavedChangesGuard } from './shared/guards/unsaved-changes.guard';

export const routes: Routes = [
  {
    path: 'login',
    title: 'Sign in',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/auth/login/login-page.component').then((m) => m.LoginPageComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell/shell.component').then((m) => m.ShellComponent),
    children: [
      // ITPO staff start at the halls, an organiser at their events.
      {
        path: '',
        pathMatch: 'full',
        redirectTo: () => (inject(AuthService).isStaff() ? 'halls' : 'external-events'),
      },

      // ITPO staff only.
      {
        path: '',
        canActivateChild: [staffGuard],
        children: [
          {
            path: 'halls',
            title: 'Halls',
            loadComponent: () =>
              import('./features/halls/pages/halls-page/halls-page.component').then(
                (m) => m.HallsPageComponent,
              ),
          },
          {
            path: 'halls/new',
            title: 'Create hall',
            canDeactivate: [unsavedChangesGuard],
            loadComponent: () =>
              import('./features/halls/pages/hall-create-page/hall-create-page.component').then(
                (m) => m.HallCreatePageComponent,
              ),
          },
          {
            path: 'events',
            title: 'Internal events',
            data: { kind: 'internal' },
            loadComponent: () =>
              import('./features/events/pages/events-page/events-page.component').then(
                (m) => m.EventsPageComponent,
              ),
          },
          {
            path: 'halls/:hallId',
            title: 'Hall',
            loadComponent: () =>
              import('./features/halls/pages/hall-detail-page/hall-detail-page.component').then(
                (m) => m.HallDetailPageComponent,
              ),
          },
          {
            path: 'events/:eventId/halls/:hallId/planner',
            title: 'Stall planner',
            canDeactivate: [unsavedChangesGuard],
            loadComponent: () =>
              import('./features/planner/pages/planner-page/planner-page.component').then(
                (m) => m.PlannerPageComponent,
              ),
          },
          {
            path: 'events/new',
            title: 'Create event',
            canDeactivate: [unsavedChangesGuard],
            loadComponent: () =>
              import('./features/events/pages/event-create-page/event-create-page.component').then(
                (m) => m.EventCreatePageComponent,
              ),
          },
          {
            path: 'events/:eventId/edit',
            title: 'Edit event',
            canDeactivate: [unsavedChangesGuard],
            loadComponent: () =>
              import('./features/events/pages/event-edit-page/event-edit-page.component').then(
                (m) => m.EventEditPageComponent,
              ),
          },
          {
            path: 'categories',
            title: 'Categories',
            loadComponent: () =>
              import('./features/categories/pages/categories-page/categories-page.component').then(
                (m) => m.CategoriesPageComponent,
              ),
          },
          {
            path: 'audit',
            title: 'Audit trail',
            loadComponent: () =>
              import('./features/audit/pages/audit-page/audit-page.component').then(
                (m) => m.AuditPageComponent,
              ),
          },
          {
            path: 'rules',
            title: 'Planning rules',
            loadComponent: () =>
              import('./features/rules/pages/rules-page/rules-page.component').then(
                (m) => m.RulesPageComponent,
              ),
          },
        ],
      },

      // Everyone signed in: staff see every external event, an organiser only their own. After the staff
      // routes, so that `events/new` is not read as an event id.
      {
        path: 'external-events/:eventId/halls/:hallId/planner',
        title: 'Stall planner',
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () =>
          import('./features/planner/pages/planner-page/planner-page.component').then(
            (m) => m.PlannerPageComponent,
          ),
      },
      {
        path: 'external-events/:eventId',
        title: 'Event',
        loadComponent: () =>
          import('./features/events/pages/event-detail-page/event-detail-page.component').then(
            (m) => m.EventDetailPageComponent,
          ),
      },
      {
        path: 'external-events',
        title: 'External events',
        data: { kind: 'external' },
        loadComponent: () =>
          import('./features/events/pages/events-page/events-page.component').then(
            (m) => m.EventsPageComponent,
          ),
      },
      {
        path: 'events/:eventId',
        title: 'Event',
        loadComponent: () =>
          import('./features/events/pages/event-detail-page/event-detail-page.component').then(
            (m) => m.EventDetailPageComponent,
          ),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
