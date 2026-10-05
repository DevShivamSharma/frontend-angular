# Homepage plaza detailing

Later outer-road and front-garden refinement: [venue-edge-alignment.md](venue-edge-alignment.md).

## ITPO exterior photo update (2 October 2026)

The user marked the previously empty court on the other side of the office and supplied
three site photographs. `venue-itpo-exterior.ts` adds three raised concrete/hedge beds,
layered broad-leaf fig shrubs, twin-head street lamps, green bins, two cream arched
open shelters, a low enclosure with terracotta louvres, and a black/yellow kerb.
A separate 4.8 × 4 m security check room stands beside Gate 9, with windows, a door,
an entrance awning and a shallow overhanging roof. Its meshes retain Gate 9 selection
through batching. These are photo-guided approximations, not surveyed dimensions.

The original office, roads, gate, east walkway and source GLB remain intact. The new
26,144 triangles form 19 material/selection batches in the isolated geometry check;
the full viewer also separates shadow and glazing semantics. The existing scene owns
all geometry/material disposal. There are no extra image downloads or animation loops.

Preview routes: `/?view=itpo-office` (marked court overview), `/?view=itpo-courtyard`
(eye-level walk), and `/?view=gate9` (gate and checkpoint). The normal Gate 9 menu view
also includes the checkpoint. Overview and gate presets fit narrow viewport widths.

All three `e2e/venue-surfaces.spec.ts` checks passed in `itpo-exterior-confirm`. They
sample the shipping model's ground beneath every new major footprint, verify the
continuous office walk and gate lane stay open, preserve authored geometry, and bound
added geometry/batches. The first run caught a checkpoint corner touching a fallback
road kerb; moving the room one metre resolved it. Natural/Color and desktop/mobile
previews were inspected in the browser; captures are in `.impeccable/review/` (ignored).

Requested finish: subtle paving/roof detail with greenery on ground only. The large open campus surfaces use the supplied model's `paved_ground` material. Existing roof geometry, roof materials, buildings, roads, map masking and labels are preserved.

## Changes

- `src/app/home/venue-surface-detail.ts`: world-aligned stone coursing on the actual paving meshes, with small slab joints and larger inset borders. Seven decorative planter beds add fourteen small trees in open ground areas. These are visual design additions, not surveyed venue features.
- `src/app/home/venue-appearance.ts`: neutral paving in Natural; the supplied red Kota stone image remains the base texture in Color, composed into matching coursing. Two cached 1024-pixel atlases, mipmaps and anisotropic filtering keep sampling consistent during movement. Color's atlas is created lazily with the existing palette. Both atlases are uploaded before display and released by the existing appearance controller.
- `src/app/home/venue-viewer.ts`: prepare the surfaces once before the existing lossless batch pass.
- `src/app/home/venue-edge-detail.ts` (`addItpoWalkway`): the ITPO office's east walkway as photographed on site (October 2026): along the ~8.5 m paved walk, a raised concrete planter in three runs with a hedge, fiddle-leaf fig shrubs, one tall street lamp per run and green bins at the crossings. Built from the model's own materials (the bins have their own green), on the "office ground court" paving; `e2e/venue-surfaces.spec.ts` ray-checks every run, bin and the clear walk against the supplied GLB. Positions are photo-guided, not surveyed. View it with `/?view=itpo-walkway` (eye level, as in the photo) or `/?view=itpo-office` (overview).
- `e2e/venue-surfaces.spec.ts`: inspect actual supplied GLB triangles to verify the planter footprints and clearance, preserve authored geometry and non-paving UVs, and bound the additional geometry/batches.

No source GLB/image was edited. There is no added network asset, second model, animation loop, per-frame geometry calculation or material update. Demand rendering, cached shadows, camera controls and the existing appearance switch remain in use. The new planters contain 2,800 triangles and batch into three material groups. Texture storage for both generated atlases is approximately 10.7 MiB including mipmaps, once both modes have been opened.

## Verification

The actual app runs on `http://localhost:4200/`. Existing Playwright checks cover Natural/Color switching and cached requests, palette failure/retry, navigation during loading, orbit/pan/wheel zoom, model and embedded-image loading, mesh selection, floor controls, globe/return, daylight, mobile resize and renderer teardown. Appearance checks compare the first rendered zoom frame with the same retained canvas 1.5 seconds later; the captured PNGs must be identical.

The geometry check casts rays through a 3-metre grid spanning each planter and surrounding clearance (18 × 12 metres), including interior samples. Every sample must hit authored paving below 0.2 metres, rather than a roof, road, building or existing planting.

Run history (27 September 2026):

| Run | Actual result |
|---|---|
| `venue-surfaces-before` | Performance baseline: 1 passed, 41.8 seconds |
| `venue-surfaces-visual` | All 8 actual-browser checks passed, 3.2 minutes |
| `venue-surfaces-geometry` | 5 passed, 1 failed: the new triangle-count check encountered a non-indexed tree crown. Crowns were given an index to match the other pieces and allow one foliage batch. |
| `venue-surfaces-confirm` | All 6 checks passed, 1.6 minutes: both appearance-stability cases, all three palette cases and the real-model geometry/clearance check |
| `venue-surfaces-after` | Final performance/idle assertions: 1 passed, 30.3 seconds |

The 15 distinct checked scenarios have passing latest results across these runs. Failed intermediate evidence is retained; this is not presented as one clean full-suite run. The separate planner suite was not rerun for this home-only change.

## Before / after performance

Same Playwright Chromium configuration, Intel Graphics via ANGLE/D3D11, 1440 × 1000 viewport, DPR 1, Natural mode and trusted-pointer movement sequence from `e2e/home-performance.spec.ts`. Tracing was disabled for both measurements. No build or other test was deliberately run alongside either performance measurement.

| Metric | Before | After |
|---|---:|---:|
| Orbit rendered FPS | 41.29 | 52.64 |
| Orbit p95 frame interval | 33.4 ms | 33.3 ms |
| Trusted input p95 delay | 29.6 ms | 22.4 ms |
| Trusted input maximum delay | 31.5 ms | 29.1 ms |
| Initial idle draw calls (3 seconds) | 0 | 0 |
| Settled draw calls (2.5 seconds) | 0 | 0 |
| Browser page errors | 0 | 0 |

No regression was observed in this paired sample. The higher after-FPS is not claimed as a guaranteed speedup: these are single runs on a shared desktop, not controlled laboratory measurements. Color mode's idle and pixel stability were verified by browser tests; a separate Color FPS baseline was not taken. GPU driver-internal work is not measured; zero draw calls refers to application WebGL drawing.

Final `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json`, `npm run build`, and `git diff --check` all passed. Production output is `dist/frontend-angular`. The build retains the existing warning categories: initial bundle 1.84 MB exceeds the 1.50 MB warning budget by 344.21 kB, and planner dependency `polygon-clipping` is CommonJS.

To reproduce the performance comparison on an existing local server:

```powershell
$env:PW_PORT = '4200'
$env:PW_RUN_ID = 'venue-surfaces-performance'
npx playwright test e2e/home-performance.spec.ts
```

Functional and geometry checks:

```powershell
$env:PW_RUN_ID = 'venue-surfaces-checks'
npx playwright test e2e/home-appearance.spec.ts e2e/home-color.spec.ts e2e/home-controls.spec.ts e2e/home-model.spec.ts e2e/venue-surfaces.spec.ts e2e/venue-batching.spec.ts e2e/home-render-loop.spec.ts
```

## Evidence

- [Browser report](../playwright-report/venue-surfaces-visual/index.html)
- [Final palette/appearance/geometry report](../playwright-report/venue-surfaces-confirm/index.html)
- [Baseline raw measurements](../test-results/venue-surfaces-before/results.json)
- [Final raw measurements](../test-results/venue-surfaces-after/results.json)
- [Natural desktop](../test-results/venue-surfaces-confirm/artifacts/home-color-appearance-lazy-9577d--toggles-and-idle-rendering/natural-overview.png)
- [Color desktop](../test-results/venue-surfaces-confirm/artifacts/home-color-appearance-lazy-9577d--toggles-and-idle-rendering/color-overview.png)
- [Natural mobile](../test-results/venue-surfaces-visual/artifacts/home-controls-natural-home-bda07-ssets-and-stops-on-teardown/home-mobile.png)
- [Color mobile](../test-results/venue-surfaces-visual/artifacts/home-controls-color-home-r-61c59-ssets-and-stops-on-teardown/home-mobile.png)

Desktop and mobile captures were inspected in two bounded passes. Generated reports/screenshots are local, Git-ignored artifacts.

## Scope

This is a decorative treatment of existing open surfaces, not an approved landscape or circulation plan. The actual app has been exercised in the repository's Playwright Chromium configuration; other browsers and devices are not certified. The earlier stall-planner changes remain untouched by this home-only follow-up.
