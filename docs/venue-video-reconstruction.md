# Venue reconstruction from video references

This pass improves the observed Hall 14 frontage, material families, covered
pedestrian network and concourse surfaces. It does **not** establish a surveyed,
complete reconstruction of every building. Existing footprint coordinates and
dimensions remain approximate; unseen elevations and interiors remain unverified.

The source model `src/assets/venue/IITF_2026_ARCHITECTURAL.glb` is unchanged at
62,914,632 bytes (62.9 MB decimal). Corrections are prepared in the viewer before
navigation capture and rendering batches. The source asset's download size has
not been reduced by these runtime changes.

## Supplied references

The original files are under `D:\Outside Bharat Mandapam`. Durations below were
read with FFprobe. All eight DJI files have a 3840 × 2160 main video stream and
no audio stream. `FINAL VIDEO 1.mp4` is 1440 × 1080 with audio.

| Source filename | Duration | Principal evidence |
| --- | ---: | --- |
| `DJI_20250217153134_0009_D.MP4` | 31.51 s | Hall 14 observed frontage, cream crown, terracotta wings and balcony bands. |
| `DJI_20250217154115_0014_D.MP4` | 33.17 s | Hall 1/2 façade family and approach context. |
| `DJI_20250217154154_0015_D.MP4` | 81.80 s | Covered hall spine, branch signs, canopy pattern, paving and fountain. |
| `DJI_20250217154322_0016_D.MP4` | 65.27 s | Continuing spine, side courts, planter seating and approach toward H6. |
| `DJI_20250217154441_0017_D.MP4` | 39.56 s | Identifiable H6, opaque striped façade, open court and flag ring. |
| `DJI_20250217163808_0038_D.MP4` | 4.02 s | Short concourse establishing view. |
| `DJI_20250217163819_0039_D.MP4` | 51.58 s | Canopy junction, sandstone pavilions, paving and temporary wayfinding. |
| `DJI_20250217163917_0040_D.MP4` | 34.45 s | Reverse concourse view, permanent H1 label and numbered sandstone portal 6. |
| `FINAL VIDEO 1.mp4` | 108.94 s | Brief venue hallway, then Reliance booth, textile displays and event decoration; insufficient coverage for permanent building interiors. |

All nine supplied videos were reviewed using timestamped samples and selected
higher-resolution inspections, not an exhaustive account of every frame. FINAL
was sampled at 0, 7, 14, …, 105
and 108 seconds. Local extraction used the watch skill without Whisper uploads.
Its initial keyframe pass failed because the installed FFmpeg no longer accepts
`-vsync`; explicit timestamp extraction succeeded. Uniform samples carry the
tool's `transcript-cue` filename label despite having been selected visually.

The local evidence ledgers and extracted images are retained under
`outputs/venue-reference/`. In particular, `east-findings.md` records the H1/Gate 6
concourse and `west-findings.md` records the hall spine/H6. Their working names do
not establish geographic bearing. This document retains the principal findings
without depending on those generated local artifacts being committed.

## Concrete changes

- **Hall 14:** `venue-reference-hall14.ts` rebuilds the observed front sector on
  the existing registered elliptical footprint. A cream crown, terracotta wings,
  recessed glazing, balcony slabs and balustrades replace the inconsistent front
  treatment. Unobserved rear geometry and the source roof footprint remain.
  Front-door metadata stays available to navigation; floating roof annotations
  absent from the reference are removed.
- **Hall and gate finishes:** `venue-reference-materials.ts` applies warm vertical
  panel variants, cream fascia, blue-gray glazing and Gate 6 sandstone courses.
  Material identities preserve these finishes across Natural/Color changes.
  H3–5 inherit the existing shared panel system; their individual sequences are
  not claimed to have been verified in the footage.
- **Canopies:** `venue-reference-canopy.ts` handles the central spine, the
  garden-to-fountain cross canopy and the covered hall approach. It fills the
  central spine's existing overhead envelope, replaces recovered opaque panel
  surfaces with patterned perforated infill, and adds batched panel framing.
  Existing support positions, route bends and roof pitch are retained. A shared
  256-pixel alpha texture provides openings without individual hole geometry;
  no new ground supports are introduced.
  The hexagonal perforation is a simplified approximation: the larger feather/eye
  motif, exact bay dimensions and every support angle are not yet matched.
- **Concourse:** `venue-reference-concourse.ts` applies dark stone bays and pale
  bands to two exact authored covered paths, and warm coursing to four sandstone
  primitives in two existing pavilion groups. Two shared 512-pixel textures use
  UV1. Positions, indices, UV0, elevations and collision surfaces are unchanged.
  Exact tactile-strip, drain and diagonal-aisle registration is insufficient, so
  these have not been added as guessed geometry.
- **Rendering:** ambient occlusion can reuse its stationary-camera mask and skip
  distant contact detail that is no longer resolved. Water updates account for
  visible spatial patches and reduce distant ripple work so inactive views can
  sleep. Final measured results belong in the validation section below.

Existing Character Mode, manual movement, **Go to hall**, hall/floor selection
and doorway behavior remain part of the experience. Controls and messages remain
in English. Reference colors are visual estimates under daylight, not calibrated
color specifications. Natural/Color appearance and the daylight controls remain
available; the reference correction does not introduce a new time-of-day system.
Daylight is now the initial view so the architecture is visible on first load.

## Building and gate coverage

Clip abbreviations below refer to the four-digit suffix in the source table.
Event boards identify destinations; they do not prove the identity of the adjacent
façade. “Retained” means the source model remains, not that it is fully verified.

| Building / area | Evidence | Coverage in this pass | Remaining uncertainty |
| --- | --- | --- | --- |
| Hall 1 | 0014:00:00–00:32; permanent H1 label in 0040:00:00 | Reference finishes; source geometry retained | Banner and canopy obscure the central entry and lower floors. Full frontage replacement deferred. |
| Hall 2 | 0014:00:00–00:32; right branch in 0015:00:28 | Reference finishes on existing façade | Exact panel sequence, entrances and unseen elevations remain unverified. |
| Hall 3 | Forward branch in 0015:00:28 | Geometry retained; shared material family updated | Individual façade has not been independently matched. |
| Hall 4 | Forward branch in 0015:00:28 | Geometry retained; shared material family updated | Individual façade has not been independently matched. |
| Hall 5 | Forward sign in 0015:00:28; right branch in 0016:01:00 | Geometry retained; shared material family updated | Glazed frontage by the flag court cannot confidently be assigned to H5 from event banners alone. |
| Hall 6 | Permanent H6 label and striped façade in 0017:00:06–00:15 | Warm panel family applied to existing building | Food-court tent hides entrances; exact panels, dimensions and unseen elevations remain unverified. |
| Hall 8 | Group destination Halls 8–11 in 0016:01:00 | Existing model retained | No individually verified exterior reconstruction in this pass. |
| Hall 9 | Same group destination evidence | Existing model retained | No individually verified exterior reconstruction in this pass. |
| Hall 10 | Same group destination evidence | Existing model retained | No individually verified exterior reconstruction in this pass. |
| Hall 11 | Same group destination evidence | Existing model retained | No individually verified exterior reconstruction in this pass. |
| Hall 12 | Left branch Hall 14,12 in 0015:00:28; temporary Hall12/12A boards | Existing model retained | Route identity is supported; complete façade and footprint are not established by these views. |
| Hall 12A | Temporary Hall12/12A boards in 0039/0040 | Existing model retained | Destination boards alone do not locate or describe its exterior. |
| Hall 14 | 0009:00:08–00:31 | Observed front-sector geometry rebuilt | Rear elevation is inherited; dimensions and unseen interior details are not surveyed. |
| Convention Centre | Existing model and prior references | Existing architecture retained; shared rendering changes apply | No complete building verification or new façade reconstruction in this pass. |
| ITPO office | Existing model and prior references | Existing architecture retained | No new building-specific geometry verified from these videos. |
| Gate 6 | Numeral 6 on sandstone portal in 0040:00:33; existing photo-based model | Sandstone course finishes; source portal geometry retained | Full label partly obscured; leaf details, dimensions and every surrounding object are not verified. |
| Gates 1, 3, 4, 5A–5C, 7–11 | Existing source registration | Geometry retained | Individual gate accuracy has not been established by this video pass. |

H1 was checked separately rather than copying H14's orientation. Its source center
is approximately `(151.534042, 0, 232.666718)` with front yaw −120°, opposite H14's
+60°. The visible cream fascia and recessed upper balcony do not justify a full
ground-to-roof replacement while the entry is obscured. Source H1 signs, roof and
visitor registration therefore remain.

## Temporary content and remaining work

Bharat Tex 2025 banners, colored hall boards, white craft booths, loose rugs,
textile products, Reliance displays, food-court tents, vehicles and generators
are event or operational content. They have not been baked into permanent venue
architecture. The flag ring's permanence and exact flag count are also unverified.

Completing the venue accurately still needs unobstructed H1 entrance coverage,
individual façades for H3–5 and H8–12A, missing gate views, unseen elevations,
interior references and a measured site plan or reliable dimensions. Tactile
routes, drainage, stairs/escalators and local pavilion placement need registration
before geometry changes. Existing accessible interiors are a separate feature;
these videos do not verify their full furnishing or floor layouts.

## Validation

The [screenshot comparison](../outputs/venue-reference/comparison.html) contains
the local reference and before/after views. The checks below validate the implemented
changes; they do not establish complete architectural coverage or production-device
performance. Run IDs identify local `test-results/<run-id>/results.json` artifacts.

| Check | Final result | Evidence |
| --- | --- | --- |
| Production build and TypeScript | Passed | `npx tsc --noEmit -p tsconfig.app.json`; [production build log](../outputs/venue-reference/production-build.log) |
| Reference geometry, material, canopy and concourse checks | Passed | `venue-video-unit-1`, `venue-video-integrated`; final Hall14 seam check in `venue-video-checks` |
| Character collision and manual entry/exit | Five collision tests passed, including all actual supported portals | `venue-video-checks` |
| Go to hall, Stop, interruption and floor selection | Furnished browser flow and final all-hall controller/timing test passed | `venue-video-final`, `venue-video-route-final` |
| English controls, Natural/Color and daylight behavior | Passed, including globe, resize, late assets and renderer shutdown | `venue-video-final`, `venue-video-lifecycle-final` |
| Desktop/mobile views and shader/page errors | Passed, no recorded shader or page errors | `venue-video-final`; screenshots and `after/runtime.json` |
| Fountain animation and reduced motion | All three fountain previews, both appearances and mobile passed | `venue-video-checks`; three render-budget tests in `venue-video-integrated` |
| Resource cleanup | Two-visit forced-GC audit and dedicated regression passed | `venue-video-lifecycle-final`; memory results below |

The [validation manifest](../outputs/venue-reference/validation.json) consolidates
the latest result for each relevant test. Earlier runs exposed obsolete expectations
that a nearby animated fountain should sleep without reduced motion, and a planner
selector from an older route. Those assertions now exercise the current behavior.
One all-hall route calculation took 1,606 ms against a 1,500 ms limit in a combined
run; the final isolated run passed the unchanged limit. An earlier browser flow
was interrupted by development-server reload and passed in the stable rerun.

The production build completed with the existing planner CSS budget warnings and
`polygon-clipping` CommonJS advisory. Initial JavaScript/CSS total is 1.26 MB raw,
312.88 kB estimated transfer, excluding separately loaded model assets. The first
sandboxed build could not resolve Google Fonts; the network-enabled build passed.

## Measured performance

The matched desktop runs use local Chromium, Intel Graphics through ANGLE/D3D11,
1440 × 1000 viewport, DPR 1 and the same evening lighting and orbit sequence, with
tracing disabled. The baseline is recorded in
[desktop-performance.json](../outputs/venue-reference/baseline/desktop-performance.json)
and the final run in
[desktop-evening-performance.json](../outputs/venue-reference/after/desktop-evening-performance.json).

| Matched desktop metric | Baseline | Integrated evening result |
| --- | ---: | ---: |
| Rendered orbit frame rate | 19.56 FPS | 29.40 FPS |
| Orbit frame interval, p95 | 66.70 ms | 50.00 ms |
| Input dispatch delay, p95 | 63.70 ms | 36.50 ms |
| Stationary overview draw calls | 156,096 over 3.03 s | 0 over 3.02 s |
| CC water view, rendered frame rate | No matched figure recorded | 39.27 FPS |
| Reduced-motion stationary draw calls | No matched figure recorded | 0 over 1.52 s |

Zero stationary draw calls means demand rendering has slept; it is not a claim
that animation should render at zero FPS. The water view still animates. About
29 FPS on the measured desktop evening route is an improvement, not a 60 FPS
guarantee across the venue or other hardware.

The separate [daylight desktop run](../outputs/venue-reference/after/desktop-day-performance.json)
recorded 35.91 rendered orbit FPS, 33.40 ms p95 frame interval and 108.60 ms p95
input dispatch delay. Its overview made zero draw calls over 3.02 seconds. This
run has different lighting from the baseline, so its 35.91 FPS must not be used
as the matched before/after result. The higher sampled input delay is retained
here rather than treating frame rate alone as proof of responsiveness.

### Mobile-sized viewport

[mobile-performance.json](../outputs/venue-reference/after/mobile-performance.json)
records a sequential local Chromium run at 390 × 844, DPR 1, on the **same desktop
Intel GPU**. There was no CPU/network throttling, mobile-device emulation or
physical-phone test, and no trace or pixel readback during performance samples.

| Metric | Measured result |
| --- | ---: |
| Overview load to interactive | 10.84 s |
| Fountain-view load to interactive | 6.98 s |
| Rendered orbit frame rate | 57.58 FPS |
| Orbit frame interval, p95 | 16.80 ms |
| Input dispatch delay, p95 | 20.70 ms |
| Stationary overview | 0 draw calls over 3.02 s |
| Rendered fountain frame rate | 59.84 FPS |
| Orbit draw calls per rendered frame | 1,073.2 |
| Fountain draw calls per rendered frame | 421.75 |
| Recorded browser errors | None in this run |

The mobile-sized run reported 564,476,952 bytes of used JavaScript heap during
orbit and **1,430,567,450 bytes (1.43 GB decimal)** in the fountain sample after
navigation, without forced garbage collection. This is a high pre-GC observation,
not measured retained memory or a leak diagnosis. It excludes GPU allocations and
browser-process memory. These results do **not** guarantee usability on a physical
phone. The subsequent retained-memory audit found and verified a teardown fix;
real-device measurements remain necessary.

### Loading and memory limits

The [runtime capture](../outputs/venue-reference/after/runtime.json) reports a
16.13 s desktop loading interval and a 559 ms source-GLB resource request. Its
588 MB used / 662 MB allocated JavaScript heap values are a subsequent
mobile-viewport snapshot, not a desktop load-memory measurement. These local
development-server captures use warm OS/server caches and are not production
network loading guarantees.

| Remaining measurement / asset | Status |
| --- | --- |
| Retained memory after teardown and collection | Measured separately below |
| GPU texture/geometry memory | Not measured; V8 heap/backing storage excludes GPU allocation |
| Physical-phone and production-network measurements | Not measured |
| Source GLB size | 62,914,632 bytes before and after; runtime changes do not reduce download size |

### Teardown correction

The first forced-GC audit showed that disposed command delegates, cleanup callbacks
and the component's viewer reference retained the initialization graph. Disposal
now drains callbacks, resets delegates, drops the visitor reference and clears the
component field. It is idempotent and also releases an unattached model when leaving
during interior loading.

The [before](../outputs/venue-reference/after/memory-before-teardown.json) and
[after](../outputs/venue-reference/after/memory-after-teardown.json) audits follow
real Angular links through viewer → planner → viewer → planner in the same document,
with two CDP garbage collections per stage. Figures combine V8 heap and backing
storage, in decimal MB; they exclude GPU and browser-process memory.

| Stage | Before fix | After fix |
| --- | ---: | ---: |
| First viewer | 553.6 MB | 553.7 MB |
| First exit to planner | 549.7 MB | 19.1 MB |
| Second viewer | 1,080.8 MB | 555.9 MB |
| Second exit to planner | 550.7 MB | 19.8 MB |

Leaving releases approximately 96.5% of the previously retained footprint. Event
listeners return from 142 to 39 on each exit. Small detached canvas wrappers remain,
but the scene/collision graph is released. An active viewer still uses approximately
554–556 MB in this development build, so this is not a low-memory/mobile certification.
