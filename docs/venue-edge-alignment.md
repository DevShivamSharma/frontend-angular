# Outer-road alignment and front garden

The second marked screenshot showed a wide, dark exterior road over a differently aligned light map, plus an empty forecourt recess. This follow-up addresses those edges while retaining the earlier plaza detailing.

## What changed

- The supplied `PHOTO_ROADS` exterior asphalt has a top-surface area of approximately 99,062 m² in model coordinates; about 98,621 m² (99.55%) lies outside the actual campus footprint. Its asphalt, markings and kerbs are now a **fallback representation**: visible while the local map is pending or unavailable, and hidden only after real bundled map roads have been constructed. The existing OSM road coordinates and widths are unchanged. Campus drives, gate approaches and parking are separate meshes and remain visible.
- The flat map group moves up 6.6 m to campus grade. This removes the former roughly seven-metre drop at the model/map seam. Geographic X/Z registration, Earth position and globe navigation remain unchanged. Registration is still approximate, not survey-accurate.
- A formal front garden fills a 140 × 52 m open recess, aligned to the existing campus axes. Four equal lawn panels, a cross path, eight paired trees and eight seats form a symmetric arrangement. The garden does not overlap the supplied campus geometry or any existing mapped building, road, park or water feature. It is a decorative proposal, not a claim about built landscaping.
- Paths and turf occupy separate geometry, with narrow kerb rings. This avoids a nearly coplanar stone slab beneath grass, which made turf appear pale in the first visual pass. Paving UV preparation also clones shared buffers before changing them, so unrelated stone/planting UVs remain intact.

Both Natural and Color retain their material palettes. New geometry is prepared once and goes through the existing batching. No new network assets, textures, animation loops, geometry calculations or material updates run per frame. Static shadow caching and demand rendering are preserved. Source GLB bytes and backend files are unchanged.

## Files

| File | Purpose |
|---|---|
| `src/app/home/venue-edge-detail.ts` | Symmetric garden and exact exterior-road fallback identification |
| `src/app/home/venue-surface-detail.ts` | Integrate the garden before batching; isolate and clean up replaced paving buffers |
| `src/app/home/venue-globe.ts` | Align map elevation; report successful local road construction |
| `src/app/home/venue-viewer.ts` | Handle either map/model loading order; keep fallback geometry separate through batching |
| `e2e/venue-edge-detail.spec.ts` | Actual map/campus clearance, mirrored tree positions and selective fallback visibility |
| `e2e/venue-surfaces.spec.ts` | Verify unchanged authored positions/indices despite copied paving buffers |
| `e2e/home-performance.spec.ts` | Optional test-browser-only control that disables the three new edge features for a performance comparison |

## Verification

Actual Chromium app at `http://localhost:4200/`, using the repository's Playwright configuration. No backend writes were required.

| Run | Actual result |
|---|---|
| `venue-edges-before` | Baseline performance: 1 passed |
| `venue-edges-visual` | 9 browser scenarios passed: Natural/Color stability, palette cache/failure/teardown, controls, selection, floors, globe, mobile resize, delayed map and unavailable-map fallback |
| `venue-edges-geometry` | 5 passed: map coverage/exclusion, new garden clearance/symmetry, selective road fallback through batching, existing plaza planter clearance |
| `venue-edges-confirm` | **10 passed** after the geometry fixes: both appearance modes, palette failures/cache/teardown, desktop/mobile controls, garden/map geometry and unchanged authored model geometry |

Visual inspection identified and corrected the lawn/stone depth overlap after the first passing browser run. The initial garden geometry test logged an assertion for every map feature; its aggregate assertion now checks the same complete dataset without thousands of report steps. Desktop/mobile Natural and Color captures were inspected in two bounded passes. No further cosmetic iteration followed confirmation.

## Performance investigation

Same Chromium/ANGLE Intel Graphics D3D11 configuration, 1440 × 1000, DPR 1, Natural mode and trusted-pointer sequence. Trace capture is disabled. No build or other test was deliberately run during a performance measurement.

| Run | Orbit FPS | Frame p95 | Input delay p95 | Initial/settled idle draws |
|---|---:|---:|---:|---:|
| `venue-edges-before` | 58.71 | 16.7 ms | 22.9 ms | 0 / 0 |
| `venue-edges-after` | 37.29 | 33.4 ms | 34.6 ms | 0 / 0 |
| `venue-edges-performance-recheck` | 38.53 | 33.4 ms | 27.9 ms | 0 / 0 |
| `venue-edges-control` — new edge features disabled **only in the test browser** | 59.08 | 16.8 ms | 16.7 ms | 0 / 0 |
| `venue-edges-current-control-pair` — final features enabled | **59.08** | **16.7 ms** | **16.8 ms** | **0 / 0** |

The first two after-runs were slower and were investigated, not discarded. A two-second process sample found approximately 7.4 CPU-seconds from VS Code processes and 1.9 from Edge; no unrelated workload was stopped. The development server was subsequently found unreachable and restored on port 4200. On the same restored server, the sequential control/current pair did not reproduce the FPS regression. Both final runs had no orbit long tasks or browser page errors.

The control changes only the intercepted development `main.js` response inside Playwright: omit the garden, restore the old map elevation and retain exterior fallback roads. Expected replacement counts are asserted. The running user app/source is not altered by this control, and it is a diagnostic variant rather than an exact historical Git checkout.

**Conclusion:** no regression was observed in the final paired sample. The earlier slower runs show sensitivity to shared-machine conditions; this is not a guarantee of 59 FPS under arbitrary concurrent load. Application draw calls stop while idle, and both appearance modes retained identical first-zoom/settled pixels. Color mode did not receive a separate FPS baseline. GPU driver-internal work and physical mobile performance were not measured.

Reproduce the control/current pair against the development server:

```powershell
$env:PW_PORT = '4200'
$env:PW_RUN_ID = 'venue-edges-control'
$env:VENUE_EDGE_FEATURES_OFF = '1'
npx playwright test e2e/home-performance.spec.ts
Remove-Item Env:VENUE_EDGE_FEATURES_OFF
$env:PW_RUN_ID = 'venue-edges-current-control-pair'
npx playwright test e2e/home-performance.spec.ts
```

Final `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json` and `npm run build` passed. Output: `dist/frontend-angular`. Existing warning categories remain: 1.85 MB initial bundle versus a 1.50 MB warning budget (346.32 kB over), and planner dependency `polygon-clipping` uses CommonJS. No compilation errors were reported.

## Evidence

- [Final confirmation report](../playwright-report/venue-edges-confirm/index.html)
- [Delayed/unavailable-map and initial controls report](../playwright-report/venue-edges-visual/index.html)
- [Map/geometry report](../playwright-report/venue-edges-geometry/index.html)
- [Baseline measurements](../test-results/venue-edges-before/results.json)
- [First slower after-run](../test-results/venue-edges-after/results.json)
- [Slower repeat](../test-results/venue-edges-performance-recheck/results.json)
- [Control measurements](../test-results/venue-edges-control/results.json)
- [Final enabled measurements](../test-results/venue-edges-current-control-pair/results.json)
- [Natural desktop screenshot](../test-results/venue-edges-confirm/artifacts/home-color-appearance-lazy-9577d--toggles-and-idle-rendering/natural-overview.png)
- [Color desktop screenshot](../test-results/venue-edges-confirm/artifacts/home-color-appearance-lazy-9577d--toggles-and-idle-rendering/color-overview.png)
- [Natural mobile screenshot](../test-results/venue-edges-confirm/artifacts/home-controls-natural-home-bda07-ssets-and-stops-on-teardown/home-mobile.png)
- [Color mobile screenshot](../test-results/venue-edges-confirm/artifacts/home-controls-color-home-r-61c59-ssets-and-stops-on-teardown/home-mobile.png)

Reports/screenshots are local Git-ignored artifacts. The 15 distinct scenario types have passing latest results across the listed runs; this is not one combined full-suite run or a code-coverage percentage.

The earlier planner suite and physical mobile hardware were not re-tested for this home-only change. No claim of exhaustive cross-browser or survey accuracy is made.
