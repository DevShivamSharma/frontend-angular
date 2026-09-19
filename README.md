# 3D Floor Planner - Angular

Angular 20 port of the React app in `../frontend`, built to the plan in
`../docs/frontend/`. The React app is untouched and remains the fallback until
parity is accepted (`10-migration-plan.md`, Phase 12 rollback).

## Running

```bash
npm install
npm start          # http://localhost:4200
npm test           # 60 specs, needs Chrome (set CHROME_BIN if not on PATH)
npm run build      # production build
```

The Java backend is expected at `http://localhost:8080/api`. See the repository
`README.txt` for how to start it. The planner works without a backend - only the
Saved Layout panel needs one, and a failed list load stays silent, exactly as in React.

## API base URL

Configured once in `src/app/app.config.ts` via the `API_BASE_URL` token
(`src/app/core/api-base.token.ts`). Change it there per deployment; no component
builds a URL (decision FD-007, FD-004).

## Layout

```
src/app/
  core/
    api-base.token.ts        API base URL, injectable
    http-error.util.ts       the axios `response.data.message || message` equivalent
  planner/
    planner-page.component.* screen shell, HUDs, provides PlannerStore
    planner-store.service.ts all state (signals) and all state transitions
    layout-api.service.ts    the five saved-layout endpoints + buildApiPayload()
    models/                  Hall, Stall, Layout request/response types
    geometry/                pure helpers: withinHall, overlaps, snapValue, ...
    excel/                   .xlsx import + template export
    three/                   scene, stall renderer, hall grid renderer
    components/              the six sidebar panels
```

Layering rule from `01-architecture.md`: `geometry/` and `models/` import nothing from
Angular or the network; components never build URLs; the Three.js code never validates.
Validation lives only in `PlannerStore`.

## Notes for reviewers

- **No NgRx.** State is feature-scoped to one screen, so it is plain signals in a service
  provided by the page (decision FD-003). `PlannerStore` is not `providedIn: 'root'`, so
  its state is discarded with the screen.
- **No react-three-fiber equivalent exists**, so `scene3d.component.ts` drives Three.js
  directly: it creates the renderer once and keeps the scene in sync through `effect()`.
  The render loop runs outside the Angular zone; pointer listeners run inside it so change
  detection still fires.
- **drei's `<Html>` labels** are plain DOM nodes in an overlay. `projectLabel()` in
  `stall3d-renderer.ts` reproduces drei's `distanceFactor` scaling formula
  (`d / (2 * tan(fov/2) * distance)`) so label sizes match the React build.
- **Native `alert`/`confirm` are kept** on save/update/delete/import (decision FD-008).
  Replacing them with modals changes interaction timing and should be a separate,
  deliberate change.
- **`xlsx@0.18.5`** is pinned to the version the React app uses. `npm audit` reports a
  high-severity advisory against it; the React app carries the same exposure. Upgrading is
  a separate decision, not a silent one.
- Every deliberate difference from the React behaviour is listed in
  `../docs/frontend/13-validation-report.md`.
