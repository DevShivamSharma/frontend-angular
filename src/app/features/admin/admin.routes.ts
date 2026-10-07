import { Routes } from '@angular/router';

import { platformAdminGuard, platformGuestGuard } from '../../core/auth/auth.guards';

export const ADMIN_ROUTES: Routes = [
  {
    path: 'login',
    title: 'Sign in',
    canActivate: [platformGuestGuard],
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
    path: '',
    canActivate: [platformAdminGuard],
    loadComponent: () => import('./admin-shell.component').then((m) => m.AdminShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'overview' },
      {
        path: 'overview',
        title: 'Overview',
        loadComponent: () =>
          import('./overview/admin-overview-page.component').then(
            (m) => m.AdminOverviewPageComponent,
          ),
      },
      {
        path: 'organisations',
        title: 'Organisations',
        loadComponent: () =>
          import('./organisations/organisations-page.component').then(
            (m) => m.OrganisationsPageComponent,
          ),
      },
      {
        path: 'organisations/new',
        title: 'New organisation',
        loadComponent: () =>
          import('./organisations/organisation-create-page.component').then(
            (m) => m.OrganisationCreatePageComponent,
          ),
      },
      {
        path: 'organisations/:id',
        title: 'Organisation',
        loadComponent: () =>
          import('./organisations/organisation-detail-page.component').then(
            (m) => m.OrganisationDetailPageComponent,
          ),
      },
      {
        path: 'roles',
        title: 'Roles and permissions',
        loadComponent: () =>
          import('./roles/roles-page.component').then((m) => m.RolesPageComponent),
      },
      {
        path: 'roles/new',
        title: 'New role',
        loadComponent: () =>
          import('./roles/role-editor-page.component').then((m) => m.RoleEditorPageComponent),
      },
      {
        path: 'roles/:id',
        title: 'Role',
        loadComponent: () =>
          import('./roles/role-editor-page.component').then((m) => m.RoleEditorPageComponent),
      },
      {
        path: 'audit',
        title: 'Audit log',
        loadComponent: () =>
          import('./audit/admin-audit-page.component').then((m) => m.AdminAuditPageComponent),
      },
    ],
  },
];
