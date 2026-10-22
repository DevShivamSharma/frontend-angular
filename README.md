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

## Visit as a Person

The venue home (`/`) has a **Visit as a Person** button. A male visitor starts outside
Gate 6, with a third-person camera. Use W/A/S/D to walk, arrow keys to turn, drag to
look, and Shift or **Walk faster** for longer campus distances. On phones, hold the
direction buttons. Select a hall under **Find an entrance**, then choose **Go to
hall** to move the visitor quickly along a clear route and through its entrance.
The visitor stops inside the selected hall. **Stop**, W/A/S/D, arrow keys or the
direction buttons interrupt auto-walk; changing the destination cancels the old
route. Buildings, water and interior furniture remain collision obstacles. If
no clear route exists, a message explains how to retry. You can also travel from
one hall to another; return to CC Level 1 before leaving an upper floor. Doors
open on approach. **Exit visit** or Escape returns to the normal overview.
Entrance openings remain visible throughout the visit. Automatic travel slows
smoothly near gates, opens sliding doors early, and eases to a stop inside the hall.

Available interiors are Hall 1–5, Hall 14 and Convention Centre levels 1–3. The CC
level buttons switch between the existing furnished floors; return to Level 1 to
walk back outside. Other buildings can be explored from the campus. The visitor
uses a 0.6 m radius, 1.9 m tall body collider against the actual building, pillar
and furniture triangles, indexed by position and floor height. Manual movement
and auto-walk share these checks and use short substeps to prevent tunnelling
at speed. Doorway cuts are shared by rendering and collision, including the
entrance aprons and CC ramp. Building and water footprints also keep visitors
out of inaccessible interiors and pools. Entrances and the CC approach are illustrative, not
surveyed access routes. No external avatar download or backend change is needed.

The original **Walk inside**, guided tours and GLB exports remain in the normal
venue menu. `venue-visitor.ts` owns input and camera state, `visitor-navigation.ts`
derives the navigation geometry, and the existing interior layer owns furnishing,
floor visibility and lighting. `visitor-avatar.ts` and `visitor-portals.ts` own
and dispose their visual resources.

Run `npx playwright test e2e/visitor-mode.spec.ts` for geometry, input, transitions,
resource cleanup and browser coverage. The tests use the checked-in venue model.
`e2e/visitor-collision.spec.ts` covers animated body clearance, thin/rotated walls,
pillars, furniture, floor separation and furnished CC access. Auto-walk controller
and browser coverage is in `e2e/visitor-auto-walk.spec.ts`.

## Walking directions

The **Directions** panel (and the phone map's Directions sheet) routes over
`src/assets/venue/venue-walkways.json`, built by `node scripts/build-venue-walkways.cjs`.
Outside the fence a route follows the traced road footpaths; inside it takes only the
ITPO app's connections (`docs/reference/campus-navigation-rn/route-map.json`), each drawn
along the traced walkways. A route with both ends inside never leaves the fence.

Gate status lives in `src/assets/venue/venue-gates.json` (from the official layout, as on
07-11-25). Visitors go in and out only through pedestrian gates (3, 4, 6, 10; Gate 8 is exit
only); VIP, cargo and office gates can be picked as a start or end but are never walked
through. **Use my location** asks for the browser's location only when picked, keeps it on
the device, and asks "Are you inside the venue?" when the fix is vague or near the fence.

Known gaps: the app has no edges for Gates 7 and 8, so each is joined to the app's network
by its nearest traced walk (about 225 m and 345 m). Gate 5C's only app edge is outside, so
it is reached along Mathura Road, as in the app. Gate 11 is closed and has no links; rebuild
the graph if it reopens. A few app edges fall back to straight links (listed under
`appEdges.straight` in the JSON).

Video-based venue updates and building/gate coverage are documented in
[Venue reconstruction from video references](docs/venue-video-reconstruction.md).
The document distinguishes verified frontage and material changes from inherited
geometry, approximate dimensions and areas still needing references.

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
