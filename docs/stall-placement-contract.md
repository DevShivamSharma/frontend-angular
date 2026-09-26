# Stall placement and split integration

The frontend owns live preview and feedback. The backend is authoritative for writes and numbering.
No backend source is changed by this frontend implementation. This contract was checked against
the local NestJS controller, DTOs and placement implementation on 2026-09-26.

## Coordinates and preview rules

- Metres, centre-origin coordinates: `posX` to the right, `posZ` down the plan.
- `width` and `length` are local X/Z dimensions. `rotation` is clockwise degrees in that plan.
  Front = local +Z, back = −Z, left = −X, right = +X; open sides rotate with the rectangle.
  Existing quarter-turn controls continue to swap dimensions and open sides together.
- `openSides` is authoritative; `gateSide` mirrors its first element for legacy clients.
- `hall.rules.minPassageWidth.B2B/B2C` stores the chosen width per event, between 3 and 5 m.
  Missing values default to 3 m. Explicit saved values are preserved and invalid values reported.
- All halls, including custom/offline halls, use placement validation. The current wall clearance,
  snap settings, openings and restricted zones remain active.
- A corner means two adjacent non-collinear edges of the actual usable hall outline are each
  within the selected passage width of the stall. Traced floor holes and disconnected floor regions
  are included. A smooth circular wall alone does not introduce synthetic corners.
- Corner pairs require separation. Other pairs can touch only along a positive-length closed
  edge with one outward open side each, facing in opposite directions. Point contact is invalid.
- Every open frontage needs a full-width, full-depth clear corridor inside its floor region.
  Walls, outside masks, holes and physical restricted zones cannot count as passage. Marked
  passage/entrance/exit areas can serve as walking space, but cannot hold a stall.
- Measurements use rectangle edges (polygons when rotated), with a 1e-6 m numerical tolerance.
  The gap from a corner stall to its nearest neighbour must not cross exterior space.
- Loaded invalid layouts remain visible for repair; saving is blocked until the preview audit passes.

## Existing layout endpoints

`POST /api/layout/save`, `PUT /api/layout/{id}`, `GET /api/layout/{id}` retain their current shape:

```json
{
  "layoutName": "Exhibition",
  "eventType": "B2B",
  "hall": {
    "name": "Hall", "shape": "SQUARE", "width": 50, "length": 50, "radius": 0,
    "rules": {
      "minPassageWidth": { "B2B": 3, "B2C": 3 },
      "peripheralClearance": 1, "gridUnit": 1, "snapStep": 1, "stallNumberPrefix": "STALL-"
    }
  },
  "stalls": [{
    "name": "Parent", "stallNumber": "5-10", "width": 11, "length": 4,
    "height": 3, "posX": 0.5, "posZ": 0, "rotation": 0,
    "color": "#3498db", "gateSide": "FRONT", "openSides": ["FRONT"]
  }]
}
```

The example's number must already have been issued by that layout. New regular stalls omit it.
Irregular `boundary`, `blockedAreas`, `zones`, `openings` and existing plan metadata also round-trip.
The frontend consumes the returned `stalls` and never assumes its temporary row ids survive a write.

## Atomic split endpoint (implemented by the current backend)

`POST /api/layout/{layoutId}/stalls/{encodedParentStallNumber}/split`

The path uses the persisted number, **not the database row id**. For parent `5-10`, 11 × 4 m
at X=0.5/Z=0, two 4 × 4 m children leave exactly a 3 m passage:

```json
{
  "idempotencyKey": "d41a57f1-bbcd-44b5-9264-8b66df6a3390",
  "children": [
    { "name": "5-10-A", "width": 4, "length": 4, "height": 3,
      "posX": -3, "posZ": 0, "rotation": 0, "color": "#3498db",
      "gateSide": "FRONT", "openSides": ["FRONT"] },
    { "name": "5-10-B", "width": 4, "length": 4, "height": 3,
      "posX": 4, "posZ": 0, "rotation": 0, "color": "#3498db",
      "gateSide": "FRONT", "openSides": ["FRONT"] }
  ]
}
```

The response is the complete layout detail, with `layout`, `hall`, and `stalls`:
the original parent is `CANCELLED` with `isSplitParent: true`; children have server-assigned
`stallNumber: "5-10-A"`, `"5-10-B"` and `parentStallNumber: "5-10"`.
The prefix is an opaque identifier, never dimensions. Suffixes are A…Z, AA, AB….
The backend's lineage key is `parentStallNumber`; no new parent-id or split-index field is required.

Frontend preview supports 2–100 equal children across local X or Z, reserving passage area inside
the parent. A back-to-back split supports exactly two children and is rejected at a corner.
Uneven dimensions on the snap grid are explained before confirmation. Preview numbers are explicitly
provisional and shown on the canvas and in the properties panel. Nothing is inserted locally until
the server confirms the split. The endpoint runs against saved state, so confirmation first reads
the saved layout and refuses to proceed if local geometry/settings differ: update the layout first.
Repeated identical attempts reuse an idempotency key. Concurrent local edits are not overwritten
by a late response; the user is directed to reopen the saved layout.

## Errors and backend dependencies

Save/update/split may return HTTP 400/409 with `message` and `violations`:

```json
{
  "message": "Placement rejected",
  "violations": [{
    "code": "CORNER_PASSAGE", "message": "Required 5 m clear passage.",
    "stallIndex": 1, "stallNumber": "5-10-B", "ruleRef": "Placement",
    "geometry": [], "relatedStallIds": ["12"]
  }]
}
```

Sparse domain errors containing only a code/number are also displayed safely. The UI locates
stalls by number before falling back to request index. Final server rejection always wins over a
successful preview. Older backends returning 404/405/501 for split leave the parent untouched and
show that splitting is unavailable. They need the split endpoint and lineage persistence above;
this frontend does not emulate a successful server write.

## Verification

```sh
npm run build
npm test -- --watch=false --browsers=ChromeHeadless
npm run test:e2e
```

Playwright uses the normal Angular development app with Vite prebundling enabled, matching
`npm start`. The browser uses `http://localhost:4200`, the existing backend CORS allowlist origin;
no browser security checks are disabled. Deployments must
allow their actual frontend origin. `e2e/stall-editor.spec.ts` uses explicit API fixtures and Angular's existing development
API only for setup/state assertions, then drives controls and real canvas pointer events. It adds no
test hook to production. `placement-geometry.spec.ts` exercises exact edge cases with the real
validator. `backend-persistence.spec.ts` uses the real local backend, creates uniquely named test
layouts, reloads through the UI and deletes only its own records. An unavailable backend is reported
as skipped, never as verified. Results: `playwright-report/index.html`, `test-results/results.json`;
screenshots and failure traces live in each test's folder. See `stall-placement-validation.md` for
the final run's outcome. On Windows, an optional `PW_RUN_ID` writes fresh artifacts under
`test-results/{PW_RUN_ID}` and `playwright-report/{PW_RUN_ID}` to avoid locks on previous files.
