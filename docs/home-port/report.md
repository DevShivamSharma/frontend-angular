# Bharat Mandapam home viewer port

Completed 26 September 2026. The home route `/` now mounts the supplied venue explorer. The initial camera shows Bharat Mandapam, not the planet. The source's optional globe control is retained.

## Source used and inspection

Repository: `C:/Users/Shivam Sharma/Downloads/3d_stall_designer_postgres_project/3d_stall_designer_postgres_project/frontend-angular`.

**Source of truth used:** `frontend-angular/outputs/venue-explorer.html` with its sibling JS/CSS/JSON and assets. The requested `output/index.html` does not exist in either repository root. The actual copied delivery is named **outputs**, plural, and its entry point is **venue-explorer.html**. Its README identifies it as the current 26 September venue delivery, and a corresponding delivery exists at `C:/Users/Shivam Sharma/Downloads/outputs/outputs`. `blender-prototype/output` was not used as the viewer.

The source contains 368 files, 395,004,098 bytes. [source-inventory.json](source-inventory.json) lists every file with its byte size, including local vendor dependencies and source/export artifacts. [conversion-plan.md](conversion-plan.md) records the conversion decisions.

- Source Three.js: **0.169.0**, from `outputs/vendor/three/package.json` and the local HTML import map. The installed NPM module is byte-identical to the supplied `three.module.js`.
- Loaders: `GLTFLoader` for `IITF_2026_ARCHITECTURAL.glb`; `TextureLoader` for Earth; `fetch` for local navigation/details and Delhi outlines. No external JavaScript CDN or web-font dependency. Fonts are the supplied Arial/Helvetica and Georgia/Times families.
- GLB: **58,845,376 bytes**, unchanged SHA-256 `2314f539932d1bc72f49ec68a21d726a7fe7e2d2f5e60b0f23258bcda97172ba`. All 222 nodes, 221 meshes, 122 materials, 6 textures and 3 embedded images remain intact. `KHR_materials_emissive_strength` is retained. The source GLB contains no animations, embedded cameras, Draco, Meshopt or KTX2 requirements; nothing of those types was removed. See [glb-summary.json](glb-summary.json).
- Effects preserved: `RoomEnvironment`/PMREM, `EffectComposer`, `RenderPass`, `SSAOPass`, `UnrealBloomPass`, `OutputPass`; AgX tone mapping, exposure 0.86, SRGB output, DPR cap 1.5, 4096×4096 PCF soft shadows, clipping and the original camera/control/flight values. Geographic desaturation `onBeforeCompile` and atmosphere vertex/fragment shaders are retained verbatim.
- External runtime services remain the original ITPO rooms endpoint `https://api.indiatradefair.com/cc/itpo/api/v1/rooms/usr/room/all` and the three `https://api.indiatradefair.com/admin/itpo/api/v1/halls?hallCategory=N&size=100` requests (N=1,2,3), plus the photo URLs those services return. The welcome gate still waits for all directories and the venue, and still offers retry on failure.

## Implementation and files changed

- Replaced `src/app/home/home-page.component.ts`, `.html`, `.css`. The standalone component uses `AfterViewInit`, `OnDestroy`, `NgZone.runOutsideAngular` and the original OnPush convention.
- Added `src/app/home/venue-viewer.ts`: a direct TypeScript port of the vanilla scene/controller. Original numbers, selections, highlights, menus, loading weights, cameras, transitions and rendering logic are preserved.
- The component uses a native shadow root to reproduce the original standalone document's CSS without inheriting the planner stylesheet or affecting `/planner`. The only CSS scope substitutions are `:root`/`body` to `:host`; a host size rule and the planner-link styling are added. Dynamic gallery DOM receives the same source CSS.
- Added `src/app/home/vanilla/venue-loading.js`, `venue-rooms.js`, `venue-halls.js`, `venue-gallery.js`, `venue-globe.js`, with four `.d.ts` boundaries.
- Added the assets listed below under `src/assets/venue/`, preserving relative names and layout. Existing `angular.json` already copies `src/assets` to `assets`; no registration change was needed.
- Updated `package.json` and `package-lock.json`: `three` and `@types/three` are pinned to **0.169.0**. These replace the older 0.164 versions to match source rendering. The types package adds its normal development-only `@webgpu/types` dependency. No other runtime dependency was introduced. Planner builds and all existing tests pass with this version.
- Added this report, plan, design contract, inventory/verification JSON and screenshots under `docs/home-port/`.

No planner source, app routes, shared styles, backend or database files were changed. Existing unrelated parent-repository changes and the untracked source delivery were preserved. No commit or push was performed.

### Plain JavaScript retained and why

The five `vanilla/venue-*.js` modules remain isolated JavaScript under the existing home feature. They contain DOM construction, heterogeneous API normalization/cache/retry behavior, focus and swipe handlers, the readiness gate, and geographic shader/motion code. They were kept under the permitted plain-JS fallback to preserve those tightly coupled behaviors without a second Angular UI implementation or a redesign of the source's dynamic data structures. The scene controller and Angular lifecycle are TypeScript; typed declarations make their integration explicit.

Changes at those JS boundaries are limited to the scoped UI root, asset URL resolver, abort signal, detached-view guards, disposal of intermediate geometry, and shadow-root-aware focus lookup. The gallery module itself is unchanged. There is no iframe.

### Teardown

Route exit aborts component-owned fetches and signal-bound listeners, cancels pending directory DOM updates, stops the animation loop, disposes controls/composer passes/render targets/environment, mesh geometry/materials/textures/image bitmaps and shadow resources, and releases the renderer context. Three 0.169's GLTFLoader does not support request cancellation; a GLB that finishes after exit is disposed immediately instead of being attached. Both normal exit and exit during a held model response were exercised. The original renderer context reports lost after navigation; returning creates exactly one viewer canvas.

## Added assets

Total: **66,254,864 bytes across 18 files**. Everything except the stylesheet is byte-identical to the corresponding supplied asset. Hashes are in [added-assets.json](added-assets.json).

| Path under `src/assets/venue/` | Bytes |
|---|---:|
| `floorplans/cc-level1.png` | 371,233 |
| `floorplans/cc-level2.png` | 386,924 |
| `floorplans/cc-level3.png` | 394,464 |
| `floorplans/hall1.png` | 497,144 |
| `floorplans/hall14.png` | 544,637 |
| `floorplans/hall6.png` | 426,018 |
| `floorplans/halls12-12a.png` | 479,364 |
| `floorplans/halls2-5.png` | 825,871 |
| `floorplans/halls8-11.png` | 399,871 |
| `floorplans/venue-map.png` | 1,786,408 |
| `geography/ATTRIBUTION.md` | 1,644 |
| `geography/delhi-context.json` | 1,094,898 |
| `geography/earth-day.jpg` | 171,528 |
| `IITF_2026_ARCHITECTURAL.glb` | 58,845,376 |
| `materials/red-kota-stone.jpeg` | 5,007 |
| `venue-details.json` | 5,866 |
| `venue-explorer.css` | 14,351 |
| `venue-navigation.json` | 4,260 |

The source's supporting material image is retained conservatively alongside its floorplan/reference assets. The unused 238 MB Blender source, 75.9 MB source-export GLB, Python export tools and full vendor distribution remain in the untouched input delivery; they are not duplicated into web assets. The used Three.js/addons are supplied by the matching NPM package.

## Removed and retained old files

The previous home viewer implementation, template and styles were fully replaced. Graph discovery and text usage checks covered the frontend, planner and parent Blender/backend tooling before removal. These 12 old home-only assets were removed, totaling **9,093,894 bytes**:

| Removed asset | Bytes |
|---|---:|
| `src/assets/buildings/ITPO_OFFICE.glb` | 1,056,840 |
| `src/assets/buildings/HALL_14.glb` | 1,897,904 |
| `src/assets/buildings/HALLS_1_5.glb` | 2,627,848 |
| `src/assets/buildings/CC_HALL_14_paving.webp` | 7,272 |
| `src/assets/buildings/CC_HALL_14_lawn.webp` | 454 |
| `src/assets/draco/draco_decoder.js` | 512,465 |
| `src/assets/draco/draco_decoder.wasm` | 192,420 |
| `src/assets/draco/draco_wasm_wrapper.js` | 58,456 |
| `src/assets/globe/EARTH.glb` | 726,368 |
| `src/assets/satellite/satellite-inner.jpg` | 1,329,009 |
| `src/assets/satellite/satellite-outer.jpg` | 683,486 |
| `src/assets/satellite/satellite.json` | 1,372 |

Retained because shared or uncertain:

- `src/assets/images/*`: used by the planner.
- `src/assets/IITF_2026_Layout.glb` (14,115,296 bytes): still referenced as geometry/placement source by `blender-prototype/generate-itpo-office.py` and `blender-prototype/import-hall14.py`.
- `src/assets/buildings/bharat-mandapam.glb chat gpt.glb` (3,648,104 bytes) and `CC_HALL_1422.glb` (2,456,128 bytes): pre-existing supplied models whose ownership/use outside the current frontend is uncertain. They are not loaded by the new viewer.
- The entire source `outputs/` delivery, including licenses and export sources.

## Verification

| Check | Result |
|---|---|
| `npx ng build` | Pass; existing 1.5 MB initial bundle warning only (1.80 MB total). [build.txt](build.txt) |
| `npx ng test --watch=false --browsers=ChromeHeadless` | **179/179 pass**, final process exit 0. [tests.txt](tests.txt), [test-exit-code.txt](test-exit-code.txt) |
| `/` on dev server | Venue loads; **zero viewer console errors/warnings**, real directory calls succeed. |
| Menus, CC Level 1, Hall 1/floor tabs, gallery next photo | Pass on vanilla and Angular; matching card counts. |
| Home, zoom buttons, daylight toggle, collapse/expand, globe round trip | Pass. |
| Resize/mobile | Matching 390×844 rendering; no new layout differences. |
| Retry after an injected room-service 503 | Pass, including background inert/restored state. |
| Keyboard hall-tab focus inside shadow root | Pass. |
| Exit during model loading and normal exit; back navigation | Pass; no late remount or page errors; old GPU context released. |
| `/planner` link | Route, component, canvas and existing fallback UI open; old viewer is destroyed. Backend-backed data is limited as described below. |

Evidence: [verification.json](verification.json), [lifecycle.json](lifecycle.json), [planner screenshot](planner.png). A test rerun briefly encountered a Windows `EPERM` while the Angular runner deleted its temporary output **after all 179 tests passed**; a subsequent identical command completed cleanly with exit 0. No application workaround or test change was needed.

### Screenshot comparisons

Desktop 1440×900, mobile 390×844, device scale factor 1, Chrome 153 on the same Intel GPU. Screenshots use the same source camera destinations and settled animations. A fixed random seed was injected into both test pages only for comparable SSAO noise; it is not part of shipping code. The loading comparison holds real requests until the same initial gate state, then releases them.

- [Loading](compare-loading.png)
- [Full venue](compare-full.png)
- [Convention Centre close-up](compare-closeup-cc.png)
- [Hall 1 close-up](compare-closeup-hall.png)
- [Mobile](compare-mobile.png)

Every individual `vanilla-*.png` / `angular-*.png` capture and amplified `diff-*.png` is saved alongside the comparisons. Only the intentional planner-link rectangle is excluded from scene pixel statistics; no part of the loading screen is excluded.

| View | Mean absolute channel difference | Pixels differing by >8 channel levels |
|---|---:|---:|
| loading | 0.000000 / 255 | 0.000000% |
| full | 0.000000 / 255 | 0.000000% |
| closeup-cc | 0.013547 / 255 | 0.041283% |
| closeup-hall | 0.002759 / 255 | 0.003576% |
| mobile | 0.000000 / 255 | 0.000000% |

The loading, full and mobile captures are **pixel-identical** outside the added planner link. Close-ups match visibly but are not byte-for-byte pixel-identical: tiny residual raster differences remain, consistent with WebGL/animation timing. Those differences are quantified rather than presented as zero. An independent screenshot review returned **ship for visual fidelity**, with no actionable mismatch. See [pixel-comparison.json](pixel-comparison.json).

### Performance

The production build and original vanilla delivery were served by the same Python HTTP-server implementation on loopback. Seven alternating pairs of fresh browser contexts used real APIs; the first pair was warm-up. FPS was sampled for 3 seconds after settling. Full run data and methodology: [performance.json](performance.json).

| Median of 6 measured runs | Vanilla | Angular production |
|---|---:|---:|
| Welcome gate ready | 1.74 s | 1.52 s |
| FPS | 17.4 | 19.2 |

No measured production regression. These are local measurements, not a guarantee across devices or networks. The earlier development-server pass was slower to become ready (Angular median 2.58 s versus vanilla 2.10 s); production figures above exclude dev transformation/debug overhead. That original evidence is retained in [development-first-pass.json](development-first-pass.json).

## Known differences, constraints and manual actions

1. The only intended visible addition is the matching **Stall planner ↗** link at top right.
2. The folder/entry-point naming differs from the task description; the actual path used is explicitly recorded above. No missing `output/index.html` was fabricated.
3. Close-ups have the small quantified pixel-level differences above; exact cross-run WebGL raster identity is not claimed.
4. The local planner backend at `http://localhost:8080` was not running. Planner navigation and fallback rendering work, and planner tests pass, but successful loading of saved layouts/halls/stall types could not be verified against that backend. Start your usual backend if you need those data; it was not modified or started by this task.
5. The source's external room/hall APIs and photos still require internet access. Their original retry/failure behavior is preserved. No fabricated fallback directory data was added.
6. The design detector found inherited low-contrast/stylistic patterns. These are intentionally preserved per the no-visual-cleanup instruction; [design-detector.json](design-detector.json) records them.
7. **Restart `ng serve` so the new asset files are served.** Use the repo's normal command/port. If installing in another checkout, run `npm ci` to obtain the pinned Three.js/types versions. There are no database migrations or other setup steps.
