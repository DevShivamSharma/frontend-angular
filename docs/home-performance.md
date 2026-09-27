# Home viewer performance — 27 September 2026

The `/` venue explorer renders on demand using the same antialiased scene, materials, lighting and cached shadows during movement and at rest. A lightweight AO layer is now applied consistently on every local camera frame, restoring depth without changing appearance after input. Only the AO mask uses half resolution (longest edge capped at 1024 pixels), with 16 samples and 45% strength. The color image stays at full canvas resolution. There is no delayed refinement timer or bloom. Idle and hidden tabs stop rendering. The GLB, page layout and backend were not changed.

## Latest result: lightweight AO always on

After the user requested retained shading depth, AO was restored as a consistent screen multiplier instead of a delayed quality switch. The normal color render stays full resolution and antialiased; only the AO mask is half resolution, capped at a 1024-pixel longest edge. It uses 16 samples, a 5-metre radius and 45% strength. This is a lightweight screen-space approximation, not baked/global illumination. It fades smoothly with distance to the globe, independently of whether the user is interacting.

The `home-always-on-ao` run passed **6 tests** (1.7 minutes), including exact equality between the first zoom frame and its image 1.5 seconds later, all controls/globe/mobile/teardown checks, performance and scheduler tests. The same Intel/D3D11/1440 × 1000 browser setup measured **59.15 rendered FPS** during drag, **17.7 ms p95 input queue delay**, no drag long tasks and **zero idle draw calls**. The preceding AO-off run was 59.38 FPS; these single-run measurements should not be interpreted as precise cross-device performance guarantees. Full measurements are stored under `alwaysOnAO` in [home-performance-results.json](home-performance-results.json).

```powershell
$env:PW_RUN_ID='home-always-on-ao'
npx playwright test e2e/home-appearance.spec.ts e2e/home-performance.spec.ts e2e/home-controls.spec.ts e2e/home-render-loop.spec.ts
# 6 passed (1.7 minutes).

npx tsc --noEmit -p tsconfig.app.json
# Exit 0.

npm run build -- --output-path=dist/home-always-on-ao-20260927
# Exit 0; existing 1.5 MB budget warning (1.79 MB bundle) and planner CommonJS warning remain.
```

Latest report: `playwright-report/home-always-on-ao/index.html`. Screenshots are under `test-results/home-always-on-ao/artifacts/`: `home-appearance-home-zoom--1998f-ical-after-the-camera-stops/home-immediate.png` and `home-settled.png` prove consistency; `home-performance-home-meas-da0c4-rusted-input-responsiveness/home-desktop.png` shows the restored depth. The controls artifact directory also contains globe and mobile screenshots. Build log: `tmp/build-home-always-on-ao.log`.

## Original performance comparison

Actual Angular development app at `http://localhost:4200`, real directory APIs and local venue assets, Chromium with Intel Graphics/D3D11, 1440 × 1000, DPR 1. These are one completed before/after pair for the initial optimization on this computer, not guaranteed FPS on other hardware. Raw measurements are in [home-performance-results.json](home-performance-results.json). The subsequent appearance fix is verified below.

| Measurement | Before | After |
| --- | ---: | ---: |
| Rendered frames/sec during the same 36-step trusted pointer drag | 6.66 | 56.43 |
| Drag frame interval, p95 | 800 ms | 16.8 ms |
| Trusted input queue delay, p95 during drag | 2,567.9 ms | 38.4 ms |
| Main-thread tasks over 50 ms during drag | 19 | 0 |
| Draw calls during the initial 3-second idle sample | 14,776 | 0 |
| Idle browser animation-frame cadence after the change | — | 59.85/sec |

“Rendered FPS” counts animation-frame samples containing WebGL draw calls. Input delay is event timestamp to capture-handler execution, not end-to-end input-to-paint latency or INP. The pointer script takes longer on the overloaded baseline. Baseline frame delivery varied substantially; an earlier hardware run measured 11.83 idle FPS. Sleeping intentionally produces zero rendered FPS: it does not mean the browser is frozen. The after sample kept the browser at approximately 60 animation frames/sec while doing no idle scene work.

The measurement harness disables Playwright trace screenshots, which force GPU readbacks and distort timing. On Windows it explicitly selects D3D11; other platforms may use software rendering and cannot be compared directly. Mobile layout was checked at 390 × 844 in the desktop browser; physical phone performance was not measured.

## Consistent appearance follow-up

The user's two screenshots exposed a perceptible change when the delayed post-processing pass replaced the moving image. The regression test reproduced it before the fix (`home-appearance-before`: 1 failed with unequal first/settled PNGs). After using a single render path, the first zoom frame and the frame 1.5 seconds later were exactly identical.

The completed `home-consistent-render` run passed all 6 checks: appearance stability, actual controls/globe/mobile/cleanup, performance, and 3 scheduler checks. With the normal canvas settings, drag rendering measured **59.38 FPS**, input queue delay p95 **16.4 ms**, no drag long tasks, and **zero idle draw calls**. The `consistentAppearance` entry in the raw JSON contains the full measurement. This is the same Intel/D3D11/1440 × 1000 test setup as above.

```powershell
$env:PW_RUN_ID='home-consistent-render'
npx playwright test e2e/home-appearance.spec.ts e2e/home-render-loop.spec.ts e2e/home-performance.spec.ts e2e/home-controls.spec.ts
# 6 passed (1.4 minutes).

npx tsc --noEmit -p tsconfig.app.json
# Exit 0.

npm run build -- --output-path=dist/home-consistent-render-20260927
# Exit 0. Initial bundle reduced to 1.77 MB; the existing bundle-budget and planner CommonJS warnings remain.
```

Latest report: `playwright-report/home-consistent-render/index.html`. The regression captures are `test-results/home-consistent-render/artifacts/home-appearance-home-zoom--1998f-ical-after-the-camera-stops/home-immediate.png` and `home-settled.png` in the same directory. Desktop, globe and mobile screenshots are also in this run's artifacts. Build log: `tmp/build-home-consistent-render.log`.

## Implementation

- `src/app/home/venue-render-loop.ts`: coalesces input into one requested frame, continues camera damping/flights, pauses when hidden and cancels pending work on disposal. There is no delayed refinement or quality change after input.
- `src/app/home/venue-viewer.ts`: integrates the scheduler with orbit, destination/level selection, zoom, lighting, resize and context restoration. Reuses the static 4096px shadow map, renders through one consistent pipeline, caches destination classification/highlights, avoids unnecessary material invalidation, and computes mesh bounding boxes to reject irrelevant raycast triangles. Hidden meshes are excluded before picking; visible occluders remain included.
- `src/app/home/venue-ambient-occlusion.ts`: renders a half-resolution, 16-sample AO mask directly over the antialiased screen. Only this scalar mask is blurred/upscaled, preserving sharp color/textures. Strength is constant for local views and fades by camera distance toward the planetary view, independently of input/motion. It resizes with the drawing buffer and disposes the pass, shader and noise texture.
- `src/app/home/venue-globe.ts`: wakes rendering when Earth/geography assets finish or a flight starts; schedules automatic navigation cooldown checks even while idle; reuses per-frame colors and flight vectors.
- `e2e/home-performance.spec.ts`: reproducible browser measurement and assertions that idle rendering stops and trusted drag/destination input wakes it.
- `e2e/home-render-loop.spec.ts`: deterministic scheduler tests for input coalescing, damping, idle sleep without another render, tab visibility and disposal.
- `e2e/home-controls.spec.ts`: actual controls, mesh selection, level selection, delayed real Earth texture, globe visibility/return, mobile resize and renderer disposal on navigation to the planner.

- `e2e/home-appearance.spec.ts`: compares the first actual zoom frame with the same canvas 1.5 seconds later. It captures PNGs and requires exact equality. The regression failed before the appearance fix and passed after it. Only this visual test preserves the drawing buffer; the FPS test uses the application's normal context settings.

The model, framing, lighting, physical shadows and controls remain. AO now stays present during movement and at rest; no effect switches on when input stops. Bloom remains omitted to retain sharpness.

## Commands and results

Run from the frontend repository in PowerShell. The existing `npm start` server and real backend were used; no backend writes or schema changes were required.

```powershell
$env:PERFORMANCE_BASELINE='1'
$env:PW_RUN_ID='home-perf-baseline'
npx playwright test e2e/home-performance.spec.ts
# Before source changes: 1 passed. Baseline mode records measurements without idle-sleep assertions.

Remove-Item Env:PERFORMANCE_BASELINE
$env:PW_RUN_ID='home-perf-after'
npx playwright test e2e/home-performance.spec.ts e2e/home-render-loop.spec.ts
# 4 passed.

$env:PW_RUN_ID='home-controls-final'
npx playwright test e2e/home-controls.spec.ts e2e/app-startup.spec.ts
# 3 passed, including both route startup checks. Globe visual assertion subsequently strengthened.

$env:PW_RUN_ID='home-controls-complete'
npx playwright test e2e/home-controls.spec.ts
# Final strengthened controls check: 1 passed (45.1 s).

npx tsc --noEmit -p tsconfig.app.json
# Exit 0.

npm run build -- --output-path=dist/home-performance-20260927
# Exit 0. Existing warnings: 1.81 MB initial bundle exceeds the 1.5 MB warning budget;
# polygon-clipping in the planner is CommonJS.
```

Early measurement attempts failed because trace screenshots overloaded the GPU and an exact button-name selector omitted the visible arrow; the harness was corrected before collecting the completed baseline. The controls screenshot initially captured empty sky during a flight: the test now counts WebGL clears as well as mesh draws before considering the scene settled. A single-pixel contrast assertion also selected dark ocean, so the final assertion samples multiple land/ocean points against the sky. These failed attempts are not reported as passes.

Reports and screenshots (relative to this repository):

- `playwright-report/home-perf-baseline/index.html` — completed baseline.
- `playwright-report/home-perf-after/index.html` — performance and scheduler checks.
- `playwright-report/home-controls-final/index.html` — startup checks and initial controls/cleanup checks.
- `playwright-report/home-controls-complete/index.html` — final controls and Earth visibility assertion.
- `test-results/home-perf-after/artifacts/home-performance-home-meas-da0c4-rusted-input-responsiveness/home-desktop.png`.
- `test-results/home-controls-complete/artifacts/home-controls-home-renderi-775b6-ssets-and-stops-on-teardown/home-globe.png`.
- `test-results/home-controls-complete/artifacts/home-controls-home-renderi-775b6-ssets-and-stops-on-teardown/home-mobile.png`.
- `tmp/build-home-performance.log` — production build output.

No pending backend dependency for this optimization. The broader planner suite was not rerun for these home-only changes.
