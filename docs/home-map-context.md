# Muted map around the venue

The home viewer now exposes the existing local OpenStreetMap context around the authored campus. Roads are pale grey, parks muted green, water blue-grey and neighbouring buildings flat footprints. Details fade into the ground between 1.8 and 3.5 km from the existing geographic origin. The fade depends on position, never on movement or an idle timer.

## Changes

- `src/app/home/venue-globe.ts`: unlit map colours, flat building footprints and spatial fade. Each feature category remains one merged mesh: four feature draws plus the ground, with no new tiles, dependencies, API keys or shadow passes.
- `src/app/home/venue-viewer.ts`: hide only the GLB's two rectangular placeholder slabs, `OUTER_GROUND` and `CONTEXT_GROUND`, when geographic context is installed. Preserve `SITE_GROUND`, authored roads, architecture, picking and navigation. The GLB bytes are unchanged.
- `src/assets/venue/geography/ATTRIBUTION.md`: describe the flat map rendering and existing approximate geographic registration. The OSM attribution link remains visible.
- `e2e/home-map.spec.ts`: delay and then release the real bundled geography; verify a visible redraw against the pending image, capture desktop/mobile, and verify the venue remains usable when the map request fails.

The bundled dataset excludes the actual authored campus footprint; areas without geographic features retain the neutral ground. These are approximate contextual outlines, not live imagery or navigation data. If the map request fails, the main venue still loads over that ground. No backend changes or dependencies are required.

## Restored nearby context

The original geographic asset omitted a much larger area than the model footprint. This left blank bands north, east and south of the campus after the rectangular ground slabs were hidden. The nearby square (±1,100 m in the existing coordinate frame) now contains fresh public OSM geometry, trimmed against the actual 211-point `SITE_GROUND` outline extracted from the unchanged GLB. The distant context is retained and clipped at the same square boundary. No invented roads or repeated decorative city blocks were added.

The importer retains roads/footpaths, closed building footprints, green areas and water from complete downloaded ways. It is simplified contextual cartography; campus registration remains approximate. The asset records the source URL, import timestamp, input/model hashes, footprint and feature counts under `nearby`. Road widths use the source tag where available, with documented illustrative defaults otherwise.

- `scripts/read-osm-map.py`: converts the actual map API XML response to way geometry using Python's standard library, omitting contributor details.
- `scripts/restore-nearby-map.cjs`: performs clipping offline using the existing polygon-clipping dependency. No clipping work is added to the rendering loop.
- `src/assets/venue/geography/delhi-context.json`: restored nearby features; 1.91 MB uncompressed, versus 1.09 MB previously.
- `src/app/home/venue-globe.ts`: supports clipped road polygons and polygon holes, retaining the same four merged category meshes.
- `e2e/home-map-data.spec.ts`: verifies coverage of all three marked sides and no overlap with the real irregular campus outline.

Recreate the asset from the frontend directory:

```powershell
Invoke-WebRequest -Uri 'https://api.openstreetmap.org/api/0.6/map?bbox=77.231,28.606,77.257,28.631' -OutFile 'tmp/delhi-nearby-osm.xml'
python scripts/read-osm-map.py tmp/delhi-nearby-osm.xml tmp/delhi-nearby-osm.json
node --preserve-symlinks --preserve-symlinks-main scripts/restore-nearby-map.cjs tmp/delhi-nearby-osm.json
```

Raw downloads remain in the ignored `tmp` directory, not in the production bundle. The first download attempts against Overpass endpoints timed out or returned HTTP 406; the direct OSM map API returned the actual geometry successfully. A first browser verification attempt under restricted network access failed at the existing external rooms/halls API loading gate and was interrupted; it is not a passing result.

## Nearby context verification — 27 September 2026

```powershell
$env:PW_RUN_ID='home-map-nearby-verified'
npx playwright test e2e/home-map-data.spec.ts e2e/home-map.spec.ts e2e/home-appearance.spec.ts e2e/home-performance.spec.ts e2e/home-controls.spec.ts e2e/home-render-loop.spec.ts
# 10 passed (2.4 minutes), with normal access to the existing external venue APIs.

$env:NODE_OPTIONS='--preserve-symlinks --preserve-symlinks-main'
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json
# Exit 0.

npm run build -- --output-path=dist/home-map-nearby-20260927
# Exit 0. Existing initial-bundle budget and planner polygon-clipping CommonJS warnings remain.
```

Desktop/mobile inspection confirms restored map features in the formerly blank bands. Data tests check all three sides and less than 0.01 m² total intersection with the real campus footprint. Controls, mesh picking, globe navigation, map failure fallback, renderer teardown and exact movement/settled shading equality passed.

**Performance comparison is inconclusive under concurrent machine load.** The combined run measured 51.09 rendered FPS and 106.4 ms p95 input queue delay; a separate rerun measured 14.36 FPS and 93.4 ms p95 input delay with 812 long tasks. A process sample identified a separate `playwright test e2e/stall-editor.spec…` process tree consuming 11.77 CPU-seconds in a two-second window while the rerun was ending. That unrelated test was not stopped. Both runs still verified zero idle GPU draws and correct wake-up after input, but passing those functional assertions does not establish a satisfactory FPS/input-delay result. No clean performance improvement or regression is claimed from these contended samples.

Latest artifacts:

- `playwright-report/home-map-nearby-verified/index.html`
- `test-results/home-map-nearby-verified/results.json`
- `test-results/home-map-nearby-verified/artifacts/home-map-home-real-map-app-82446--without-covering-the-venue/home-map-desktop.png`
- `test-results/home-map-nearby-verified/artifacts/home-map-home-real-map-app-82446--without-covering-the-venue/home-map-mobile.png`
- `playwright-report/home-map-nearby-performance/index.html` — contended measurement rerun, not an isolated benchmark.
- `tmp/home-map-nearby-verified.log`
- `tmp/home-map-nearby-performance.log`
- `tmp/build-home-map-nearby.log`

## Initial map verification — 27 September 2026

Run from the frontend repository in PowerShell against the actual app on `http://localhost:4200`, using the available backend. Map tests delay or abort only the real local geography request; they do not fabricate map or API responses.

```powershell
$env:PW_RUN_ID='home-map-confirmed'
npx playwright test e2e/home-map.spec.ts e2e/home-appearance.spec.ts e2e/home-performance.spec.ts e2e/home-controls.spec.ts e2e/home-render-loop.spec.ts
# 8 passed (1.9 minutes).

npx tsc --noEmit -p tsconfig.app.json
# Exit 0.
npm run build -- --output-path=dist/home-map-context-20260927
# Exit 0. Existing initial-bundle budget and planner polygon-clipping CommonJS warnings remain.
```

The final browser run measured **58.82 rendered FPS** during trusted dragging, **16.8 ms p95 frame interval**, **17.9 ms p95 input event queue delay**, no long tasks during the drag sample, and zero GPU draw calls while idle. Environment: Windows Chromium, ANGLE Intel Graphics / Direct3D 11, 1440 × 1000, DPR 1. The preceding always-on shading run measured 59.15 FPS on this machine; these samples are observations, not a cross-device guarantee. Mobile checks use an emulated viewport, not a physical phone performance benchmark.

The first attempt reported 6 passes and 2 failures. A watched asset edit reloaded the dev server during the controls test. A map assertion incorrectly required unfaded exact palette colours, despite the spatial fade and AO; the test now checks visible geographic changes at the same camera pose. Visual inspection also identified the second rectangular placeholder slab, which is now hidden. The final run above passed all eight checks.

Artifacts relative to this repository:

- `playwright-report/home-map-confirmed/index.html`
- `test-results/home-map-confirmed/results.json`
- `test-results/home-map-confirmed/artifacts/home-map-home-real-map-app-82446--without-covering-the-venue/home-map-desktop.png`
- `test-results/home-map-confirmed/artifacts/home-map-home-real-map-app-82446--without-covering-the-venue/home-map-mobile.png`
- `test-results/home-map-confirmed/artifacts/home-map-home-venue-remain-05269-he-map-asset-is-unavailable/home-map-unavailable.png`
- `tmp/home-map-confirmed.log`
- `tmp/build-home-map-context.log`

Planner and backend suites were not rerun for this home-only change.
