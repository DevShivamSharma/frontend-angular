# Angular venue model integration — 27 September 2026

The homepage uses the model supplied in `outputs/outputs/IITF_2026_ARCHITECTURAL.glb`. Natural (the source package calls this Neutral) and Color share the same model geometry, camera and interaction state. Color loads `venue-colour-materials.glb` once, on demand; this asset contains zero mesh geometry. Only matching material dependencies are decoded, and the existing floor-plan textures are reused. The separate standalone viewer and its perpetual animation loop are not imported.

## Assets and alignment

- Architectural GLB: 62,914,632 bytes, SHA-256 `e998ea8716b8ff7a233f49aed65992bdf9d071e93697948badbef09df15e02ac`.
- Color material library: 18,471,048 bytes, SHA-256 `9ea9ce45b367d4c760e9538bb76c3566d00ad538c8b52c82950b96d0b0534b0b`; 145 materials, 33 embedded image definitions, no meshes. The 3 duplicate floor-plan images are not decoded again.
- The latest package's main GLB is byte-identical to the first supplied replacement inspected during this task. Its nested location changed and the palette was added.
- Original versus replacement: 222 → 968 authored nodes; 727,233 → 808,247 triangles; 122 → 146 materials. No geometry simplification or texture downsampling was applied. The two pre-existing context slabs remain hidden, as before, to expose the surrounding map.
- Geometry already uses metres, Y-up, east +X / south +Z; root scale/position/rotation stay identity. Navigation coordinates alone use the supplied W conversion. Gate selection uses actual `gate_id` metadata and supplied cameras; existing hall and CC identities remain valid. Roof labels and interior reference assets remain.
- Existing detail JSON, floorplans and Earth JPEG were hash-compared with the supplied copies and matched. Existing surrounding geography was retained instead of replacing it with the older bundled geography.
- The exclusion is recomputed offline from the transformed SITE_GROUND top faces, low office/admin ground surfaces, campus paths and Gate 6 entry apron. It covers 515,996.33 m², including the new office-side extension. It does not reuse just the former SITE_GROUND polygon. Restored OSM polygons are tested for <0.01 m² overlap with this union.

## Rendering and lifecycle

Opaque static geometry is batched once by material, attributes, destination, highlight behavior, clipping and shadow semantics. Transparent surfaces keep individual sorting, floor objects keep their hierarchy, UVs/triangles/transforms are preserved, and unused source buffers are disposed. Material changes happen only when the appearance is explicitly changed. No mode-specific render loop or movement/idle quality switch was introduced. Demand rendering, cached static shadows, constant AO and full-resolution antialiased color remain.

A mode switch keeps material instance identities, refreshes selection baselines and reapplies the active highlight. Camera pose and floor selection are preserved. Both cached palettes, GPU textures and decoded bitmaps are released on teardown, including completion of a pending palette load after disposal. Failed Color downloads leave Natural usable and offer retry.

## Changed files for this task

| Files | Change |
| --- | --- |
| `angular.json` | Serve only the supplied architectural GLB/navigation at the venue URLs; exclude the old equivalents; publish the palette. |
| `src/app/home/venue-viewer.ts`, `venue-batching.ts` | Replacement loader, gate metadata/cameras, one-time batching, appearance integration. |
| `src/app/home/venue-appearance.ts`, `venue-appearance.css` | Lazy material palette, switching, cleanup and responsive mode controls. |
| `src/app/home/venue.models.ts`, `home-page.component.ts`, `home-page.component.html` | Gate destination types/menu and Natural/Color UI state. |
| `scripts/model-footprint.cjs`, `scripts/restore-nearby-map.cjs` | Offline transformed-geometry mask extraction and map regeneration. |
| `src/assets/venue/geography/delhi-context.json`, `ATTRIBUTION.md` | Updated footprint, model hash, clipped nearby data and attribution. |
| `playwright.config.ts` | Optional fresh-server port, avoiding stale asset mappings. |
| `e2e/home-model.spec.ts`, `home-color.spec.ts`, `venue-batching.spec.ts` | Exact model identity, embedded images, gate/pan/wheel checks, palette/idle/retry behavior and lossless batching. |
| `e2e/home-appearance.spec.ts`, `home-controls.spec.ts`, `home-performance.spec.ts`, `home-map-data.spec.ts` | Both appearance modes, optional Color performance run and current-model footprint checks. |
| `docs/model-asset-audit.json`, this report, `docs/model-performance-results.json` | Asset audit, actual results and measurements. |

Existing uncommitted AO/map work, unrelated source assets and user-provided outputs were preserved. No backend files were changed.

## Validation notes

Final measured results are recorded below after all test processes complete. Reports from superseded runs are retained for audit:

- `model-after`: invalid as replacement evidence because the reused dev server still served the old asset configuration. Do not count those browser passes for the new model.
- `model-verified`: 9 passes; exact-model test hit Chromium inspector body eviction on the 60 MB response. This was a test harness failure.
- `model-modes`: 14 passes; Color controls was interrupted by a dev-server reload when map metadata was saved, and the model hash harness still encountered body eviction. No source/asset writes are made during the confirming run. The corrected hash harness fetches the real server response and forwards identical bytes to the loader.

## Limits

The authored model and OSM registration are approximate, as identified in their source metadata; this work aligns their supplied coordinate frames rather than claiming survey accuracy. Color's first activation downloads an additional 18.47 MB and initializes its textures/shaders; subsequent toggles use the cache. Floor controls retain the existing room-gallery behavior; no new floor cutaway feature was added. Tests use desktop Chromium on this Intel GPU plus a 390 × 844 responsive viewport, not physical mobile hardware or all browsers. GPU sleep evidence means zero application draw calls/clears; it is not an operating-system GPU power measurement. Input delay measures trusted DOM event delivery, not full hardware-to-photon latency. External machine load was not locked, and the original baseline is one run; results must not be represented as a universal smoothness or 60 FPS guarantee.

## Final results

Same Intel ANGLE D3D11 GPU, Chromium, 1440 × 1000 viewport and DPR 1, with the same trusted-input orbit path and destination action. Final measurements ran after builds and other test browsers had stopped. External load was not controlled/recorded for the baseline, so this is an observed comparison, not proof of regression-free smoothness under strictly matched machine load.

| Orbit metric | Before | Natural | Color |
| --- | ---: | ---: | ---: |
| Rendered FPS | 38.8 | 52.6 | 53.0 |
| Frame interval p95 (ms) | 33.4 | 33.4 | 33.3 |
| Input delivery p95 (ms) | 50.6 | 21.1 | 23.8 |
| Input delivery max (ms) | 54.0 | 24.9 | 24.7 |
| Idle draw calls, before and after interaction | 0 / 0 | 0 / 0 | 0 / 0 |

Natural and Color showed higher observed orbit FPS and lower input-delivery delay than the baseline. Orbit p95 remains about 33.3 ms, so this is not locked 60 FPS. Destination frame p95 improved from 33.3 ms to 16.7 ms in both appearances. Raw metrics, GPU identifiers and durations are in `model-performance-results.json`.

Completed validation:
- 17 targeted functional cases ultimately passed: 14 passes in `model-modes`; corrected Natural/Color controls and exact-model checks all passed in `model-modes-confirmed` (3/3, including one repeated prior pass); pending-palette teardown passed in `model-natural-perf`. The two earlier harness failures are retained and explained above.
- Both performance runs passed idle/interaction assertions: Natural in `model-natural-perf` and Color in `model-color-perf`.
- Both modes passed exact first-zoom-versus-settled PNG equality. Mode toggling restored Natural pixels exactly, retained selection, and requested the palette only once. Failed download/retry passed.
- Actual mesh selection, destination flight, Gate 6, all three floor buttons, right-drag pan, wheel zoom, both lighting settings, globe and return, 390 × 844 resize and route teardown passed. The model SHA-256, exactly one geometry request and three embedded image decodes were asserted.
- Map loading after idle, map-unavailable fallback, nearby coverage, actual footprint overlap, scheduler pause/disposal and lossless batching checks passed.
- TypeScript: `node --preserve-symlinks --preserve-symlinks-main node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json` — exit 0.
- Production: `npm run build -- --output-path=dist/model-modes` — exit 0. Packaged model/palette hashes match the supplied files. Warnings: 1.82 MB initial bundle exceeds the existing 1.5 MB warning budget; existing planner polygon-clipping is CommonJS. Log: `tmp/model-integration/build-modes.log`.
- UI detector: no findings (`tmp/model-integration/modes-detector.json`). Broader planner regressions, physical mobile devices and other browser engines were not rerun.

Reports and screenshots:
- Baseline report: `playwright-report/model-before/index.html`.
- Functional reports: `playwright-report/model-modes/index.html` and `playwright-report/model-modes-confirmed/index.html`.
- Performance / pending-load teardown: `playwright-report/model-natural-perf/index.html`, `playwright-report/model-color-perf/index.html`.
- Natural: `test-results/model-modes/artifacts/home-color-appearance-lazy-9577d--toggles-and-idle-rendering/natural-overview.png`.
- Color: `test-results/model-modes/artifacts/home-color-appearance-lazy-9577d--toggles-and-idle-rendering/color-overview.png`.
- Color detail: `test-results/model-modes/artifacts/home-color-appearance-lazy-9577d--toggles-and-idle-rendering/color-hall1.png`.
- Gate 6: `test-results/model-modes-confirmed/artifacts/home-model-home-model-exac-1be5e-te-navigation-pan-and-wheel/new-model-gate6.png`.
- Mobile Color: `test-results/model-modes-confirmed/artifacts/home-controls-color-home-r-61c59-ssets-and-stops-on-teardown/home-mobile.png`.

The standalone package's animated water and camera-following light pool were not imported; the existing static scene lighting/shading pipeline is retained so idle rendering can stop. Authored GLB geometry and both material appearances remain intact.


## Preview

Fresh Angular dev server: http://localhost:4202/ . This server uses the updated asset mappings. An older dev server on another port may need restarting after angular.json changes. Final TypeScript output is saved in `tmp/model-integration/typecheck.log` (exit 0).

## Follow-up: synchronized surrounding map colors

Color now changes the surrounding OSM map, ground/fade and local background with the campus palette: green parks, blue water, warm buildings and light roads. Earth uses full texture saturation in Color and its existing muted saturation in Natural. Natural restores the original map exactly. Colors and the shared shader uniform are changed once per explicit selection; no geometry, texture download, per-frame update or additional render pass is added.

Changed: src/app/home/venue-globe.ts, src/app/home/venue-viewer.ts, e2e/home-color.spec.ts. The browser check now specifically asserts changes in the upper map strip, outside campus geometry, as well as exact restoration and idle sleep.

Validation: map-color — 6/6 Playwright checks passed (appearance stability, map/model toggles, download retry, pending-load teardown, globe/controls/resize, performance). TypeScript exit 0. Production build dist/map-color exit 0; existing 1.82 MB budget and planner CommonJS warnings remain. UI detector: no findings.

Performance on the same GPU/viewport: first run 52.0 FPS, frame p95 33.3 ms, input p95 62.8 ms; isolated repeat without code changes 56.5 FPS, frame p95 33.2 ms, input p95 20.9 ms. Idle draws were zero in both. The first latency spike was not reproduced and its cause was not established. External load was not controlled; both samples are preserved in docs/map-color-results.json. Prior Color measurement was 53.0 FPS / 33.3 ms / 23.8 ms.

Report: playwright-report/map-color/index.html; repeat: playwright-report/map-color-perf-confirmed/index.html. Screenshot: test-results/map-color/artifacts/home-color-appearance-lazy-9577d--toggles-and-idle-rendering/color-overview.png. Build log: tmp/model-integration/build-map-color.log.
