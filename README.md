# Venue platform — web app

Angular 20 front end of the multi-venue stall-planning platform. One domain serves every
exhibition centre (organisation); each one lives under its own slug and its own look.

| URL | What it is |
| --- | --- |
| `/<org>/login`, `/<org>/accept-invite`, `/<org>/forgot-password` | The organisation's branded sign-in pages |
| `/<org>` | Its workspace: home, team, settings, audit log (shown by permission) |
| `/admin` | The Super Admin console: organisations, roles and permissions, audit log |
| `/`, `/invalid-link`, any unknown slug | The invalid-link page; it lists no organisations |

## Running

```bash
npm install
npm start            # http://localhost:4200, /api proxied to the backend on :8080
npm test             # unit tests (Karma); set CHROME_BIN if Chrome is not on PATH
npm run test:e2e     # browser tests with a mocked API (Playwright, installed Chrome)
npm run build        # production build; API_BASE_URL overrides the default /api
```

The backend is `../backend-nest`; its README explains how to create the first Super Admin.

## Structure

```
src/app/
  core/        api models and tokens, auth (session, interceptor, guards), org guards and
               stores, theme engine, UI services (snackbar, confirm dialog, page titles)
  shared/      reusable components: shell layout, brand mark, config form, audit table…
  features/
    auth/          sign-in, accept invitation, forgot and reset password
    admin/         Super Admin console (organisations, roles matrix, role editor, audit)
    org/           organisation workspace (home, team, settings, audit, no-access)
    invalid-link/
```

Standalone components, signals, `OnPush` and zoneless change detection throughout; routes
are lazy; forms are typed reactive forms.

## How the main pieces work

- **Session.** The access token lives in memory only. The refresh token is an httpOnly
  cookie scoped to `/api/auth`; at start-up the app swaps it for a new access token, so a
  reload keeps you signed in. A 401 triggers one refresh and a retry (`auth.interceptor.ts`).
- **Organisation in the URL.** `organisationGuard` loads `GET /api/orgs/<slug>/public-config`
  before anything renders: unknown or suspended → invalid-link page; an old slug → redirect
  to the current one; otherwise its theme is applied. `organisationMemberGuard` then checks
  membership and loads the member's permissions.
- **Permissions, not roles.** Pages and buttons check `OrgContextStore.can('team.invite')`
  etc. Roles are data the Super Admin edits; the server enforces the same checks.
- **Theming.** Angular Material 3. `ThemeService` generates every `--mat-sys-*` colour token
  (light and dark) from the organisation's seed colour with
  `@material/material-color-utilities`, and loads its font. Component styles use only these
  tokens, so a new organisation needs no code.
