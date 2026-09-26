# Bharat Mandapam: Angular-native home viewer

Completed 26 September 2026. The home page now uses **Angular components/templates and TypeScript throughout**. The previous hybrid port's five plain-JavaScript modules and declaration shims are removed. There is no iframe, injected HTML, standalone-page wrapper or runtime JavaScript loader. The initial view remains Bharat Mandapam; the source's optional globe is preserved.

## Source of truth

Actual vanilla path used for this conversion and all current comparisons: **`C:/Users/Shivam Sharma/Downloads/outputs/outputs/venue-explorer.html`**, with its sibling JS/CSS/assets. The matching `frontend-angular/outputs/venue-explorer.html` was used in the preceding port but is no longer present in this checkout. The task's literal `output/index.html` is absent; the delivered viewer is named `outputs`, plural. `blender-prototype/output` was never used as the viewer.

Repository: `C:/Users/Shivam Sharma/Downloads/3d_stall_designer_postgres_project/3d_stall_designer_postgres_project/frontend-angular`. Source inventory: [368 files and their byte sizes](source-inventory.json), totaling 395,004,098 bytes. [Implemented plan](conversion-plan.md). The earlier hybrid implementation/report and its original evidence remain historical; all current verification is under **`angular-native/`**.

Source and installed Three.js are **0.169.0**, including matching types. The source uses a local import map/vendor tree, with no external JS CDN or web-font dependency. The current conversion changes no packages or lockfile and adds no dependency. The preceding port's version pin remains. Arial/Helvetica and Georgia/Times font stacks are preserved.

Loaders/effects: GLTFLoader, TextureLoader, local metadata/Delhi JSON, RoomEnvironment/PMREM, EffectComposer, RenderPass, SSAOPass, UnrealBloomPass and OutputPass. Original AgX exposure 0.86, SRGB output, DPR cap 1.5, 4096-square PCF shadows, camera/control values, clipping, geographic desaturation shader and atmosphere shaders remain. The untouched GLB has 222 nodes, 221 meshes, 122 materials, six textures and three embedded images; KHR_materials_emissive_strength is retained. It has no embedded animations/cameras or Draco, Meshopt or KTX2 requirement to port. [GLB inspection](glb-summary.json).

The original rooms API and three hall-category requests remain at `api.indiatradefair.com`, along with the photo URLs they return. Loading still waits for venue/rooms/halls weighted 80/10/10. Venue retry reloads; directory retry reruns failed stages. Real directory data, shared-hall naming, gallery ordering, lazy images, placeholders, source quirks and animations remain.

## What became Angular and TypeScript

- **HomePageComponent** owns the canvas, navigation, active selections, tool buttons, status, geography credit and Angular RouterLink. Standalone, OnPush, AfterViewInit/OnDestroy and NgZone remain the existing pattern.
- **VenueLoadingComponent + VenueLoadingState** render the source welcome UI using typed signal/computed state, progress bindings, retry and background inert bindings.
- **VenueDetailsComponent, RoomBrowserComponent and HallBrowserComponent** render source details, level/floor tabs and directory cards using Angular inputs, outputs, loops and conditionals.
- **PhotoGalleryComponent** owns image state, counters, load/error placeholders, arrow keys and swipe input through Angular bindings.
- **FloorPlanDialogComponent** owns the supplied-plan modal, image bindings, fit/zoom controls and Original link. Native dialog showModal/close and element measurement remain appropriate browser operations.
- **VenueDataService** is scoped to one home visit. Typed parsing, coalesced requests, caches, timeout and AbortController disposal replace the room/hall JS helpers.
- **venue-viewer.ts + venue-globe.ts** contain the exact scene/geography behavior with typed commands/callbacks. They render into Angular's canvas and never construct interface HTML. The frame loop and scene controls execute outside Angular's zone; low-frequency callbacks update Angular state.

**Plain JavaScript retained: none.** Three.js remains its normal NPM library dependency. Angular's `ViewEncapsulation.ShadowDom` isolates the exact source CSS from shared/planner CSS; it is not a vanilla-page embedding mechanism. Original CSS is now bundled through component `styleUrls`, split at rule boundaries to respect component style budgets. The supplied markup/spacing is preserved through attribute-selector child components where additional host boxes would alter layout.

Teardown stops rendering, removes signal-bound scene listeners, aborts service requests, ignores late component responses and releases controls, passes, render targets, environment, geometry, materials, textures/image bitmaps, shadows and the WebGL context. GLTFLoader 0.169 cannot cancel its model request; a late model is disposed and never remounted. Angular removes template handlers and component views.

## Files, assets and removals

[Complete changed-file listing](angular-native/files-changed.txt). Implementation changes are confined to `src/app/home/`, removal of obsolete `src/assets/venue/venue-explorer.css`, and documentation/evidence. Seven standalone components, a typed data service, loading state, models and globe TS module are under the existing home folder. Four new spec files add 12 behavior tests.

Removed in this conversion: `vanilla/venue-gallery.js`, `venue-globe.js`, `venue-halls.js`, `venue-loading.js`, `venue-rooms.js` and all four declaration shims, after reference checks. Removed the external CSS asset after moving its exact rules into Angular styles. No new scene assets were needed. The **17 remaining venue assets total 66,240,513 bytes** and are all byte-identical to the supplied source. [Current sizes/hashes](angular-native/retained-assets.json).

| Path under src/assets/venue | Bytes |
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
| `venue-navigation.json` | 4,260 |

The main GLB remains 58,845,376 bytes, SHA-256 `2314f539932d1bc72f49ec68a21d726a7fe7e2d2f5e60b0f23258bcda97172ba`. Existing angular.json already registers `src/assets`; no config change was needed.

The preceding port removed 12 positively home-only assets (9,093,894 bytes): [original removal inventory](removed-assets.json). Shared/uncertain files remain: planner `src/assets/images/*`; `IITF_2026_Layout.glb` referenced by Blender tooling; `buildings/bharat-mandapam.glb chat gpt.glb` and `buildings/CC_HALL_1422.glb` of uncertain external ownership; the source supporting material/floorplan files and external original delivery. No Blender source/export tools or vendor tree are newly bundled.

Planner source/tests, app routes, global styles, package files, backend and database are unchanged in this conversion. No commit or push was performed.

## Current verification

| Check | Result |
|---|---|
| Production build | Pass, exit 0. Initial bundle 1.70 MB; only the existing 1.50 MB initial-budget warning. [Log](angular-native/build.txt) |
| ChromeHeadless unit tests | **191/191 pass**, exit 0, including all 179 existing tests. [Log](angular-native/tests.txt) |
| Home browser | Real model/directories load; zero viewer console warnings/errors. [Evidence](angular-native/verification.json) |
| Controls | CC levels, hall floors, galleries, close, collapse, daylight, zoom, globe/home and mobile pass; nine room cards and one hall card match source. |
| Retry and teardown | Injected 503 retry, inert/restored state, keyboard tab focus, leaving during held model load, no late remount and context release pass. [Evidence](angular-native/lifecycle.json) |
| Floor-plan dialog | Open, zoom, fit, resize, Original link, Escape and close button pass. [Evidence](angular-native/dialog.json); destination selected through the public component command. |
| Planner link/back | Planner component and fallback canvas render; returning gives exactly one home canvas. Backend unavailable as noted below. |

New tests cover weighted loading/coalescing/retry/late updates, directory normalization and fetch lifetime, gallery buttons/keyboard/swipes/error state, room level output and destruction guards. No planner test was rewritten.

## Visual comparison

Current comparisons: [loading](angular-native/compare-loading.png), [full venue](angular-native/compare-full.png), [CC close-up](angular-native/compare-closeup-cc.png), [Hall 1 close-up](angular-native/compare-closeup-hall.png), [mobile](angular-native/compare-mobile.png). Individual images and amplified differences are saved alongside them.

Same Chrome/GPU, cameras, 1440×900 desktop and 390×844 mobile, DPR 1. Test-only seeded randomness aligns SSAO; it is not shipped. Loading requests were held at the same initial state then released. Only the required top-right planner link rectangle is excluded from scene statistics; no loading area is excluded.

| View | Mean channel error | Pixels differing by >8 channel levels |
|---|---:|---:|
| loading | 0.000000/255 | 0.000000% |
| full | 0.000000/255 | 0.000000% |
| closeup-cc | 0.009174/255 | 0.028455% |
| closeup-hall | 0.002843/255 | 0.003576% |
| mobile | 0.000000/255 | 0.000000% |

Loading, full and mobile are pixel-identical outside the added link. Close-ups match visibly but have the quantified tiny raster differences; byte-for-byte cross-run WebGL identity is not claimed. Independent finish review: **ship**, no material visual findings. [Metrics](angular-native/pixel-comparison.json), [review](angular-native/visual-review.md).

## Performance and limits

Production and vanilla were served by the same Python HTTP server implementation on loopback, alternating fresh contexts, real APIs, identical viewport/GPU. Each batch has seven pairs; the first is warm-up and six contribute to medians. Initial three-second frame samples varied substantially, so one confirmation batch used two seconds settling and ten-second samples. Both batches are retained; no rendering quality was reduced.

| Batch | Vanilla ready | Angular ready | Vanilla FPS | Angular FPS |
|---|---:|---:|---:|---:|
| Initial 3-second FPS sample | 2.558s | 2.648s | 22.20 | 21.74 |
| Confirmation 10-second FPS sample | 2.639s | 2.760s | 21.72 | 22.99 |

[Initial measurements](angular-native/performance.json), [confirmation measurements](angular-native/performance-confirmation.json). These are local samples including external API timing and GPU contention, not a guarantee across devices. The initial sample measured Angular 3.5% slower to ready and 2.1% lower FPS; do not treat it as a strict no-regression pass. The longer confirmation measured Angular 4.6% slower to ready (about 121 ms) and 5.9% higher FPS. The strict load-time requirement therefore remains unmet in these local samples; no source behavior or rendering quality was changed to hide that overhead. The frame-loop algorithms, effects and quality settings remain source-identical; Angular also carries the existing planner application bundle. Universal equal-or-better load time/FPS cannot be established from this environment.

## Known differences and manual actions

1. The matching **Stall planner ↗** link is the intentional visible addition. Source identity, assets, typography, layout and behavior are retained.
2. Small close-up pixel differences and measured performance variability are disclosed above; strict zero-difference/performance guarantees are not claimed.
3. Planner navigation and all existing tests pass, but `http://localhost:8080` refused backend connections. Successful saved-layout/hall/stall-type loading could not be verified. Start the usual backend when those data are needed; it was not modified or started.
4. The source ITPO APIs/photos still require internet. Their loading/error/retry behavior is preserved; no fabricated directory fallback was introduced.
5. Source visual quirks and inherited detector findings are intentionally preserved. [Design contract](DESIGN.md), [historical detector](design-detector.json).
6. **Restart `ng serve` so the asset changes are served.** No new install, migration or database step is required for this conversion.
