# Venue model swap: Bharat Mandapam CAD model

The home explorer now loads `src/assets/venue/bharat-mandapam.meshopt.glb` (Git LFS). The earlier
`IITF_2026_ARCHITECTURAL.glb` stays in the repo; going back is one line in `src/app/home/venue.models.ts`:
`VENUE_MODEL = PREVIOUS_VENUE_MODEL`. The new model is the layout; the navigation, walkway, site-detail and map JSON
files are unchanged and stay in the explorer frame (world X/Z metres, Y up, east +X, south +Z).

## From the supplied file to the asset

`node scripts/prepare-bharat-mandapam.mjs <supplied.glb>`; check with `node scripts/verify-bharat-mandapam.mjs <supplied.glb> src/assets/venue/bharat-mandapam.meshopt.glb`.

| | Supplied (`bharat-mandapam-working.meshopt.glb`) | Asset |
| --- | --- | --- |
| File | 227 MB | 38.4 MB |
| Nodes | 35,169 | 34,765 |
| Triangles | 36.1 M | 4.36 M |
| Decoded geometry (quantized) | 520 MB | 55.6 MB |
| Materials / textures | 75 / 0 | 75 / 0 |

- Removed: the 381 stacked copies `DWG circulation edges · cascade reference.001–.381` and the 23 copies
  `DWG landscape edges · cascade reference.001–.023` (same transform, 94–97 % the same triangles; first copy kept).
- Lossless otherwise: 90,473 accessors compared, 0 mismatches (vertex data byte-identical; index data the same
  triangles in the same winding, as the meshopt index codec may start a triangle at another corner).
- Frame: same axes (Y up, X/Z ground, not mirrored); a similarity fitted on the four reference halls and baked into
  every node: scale 1.06122, rotation about Y −0.4589°, translation X −86.38 m, Z −26.20 m.

| Hall | Reference | After the fit | Residual |
| --- | --- | --- | --- |
| CC | (−345.2, 129.0) | (−346.0, 134.0) | 5.0 m |
| Hall 14 | (−223.6, 4.9) | (−217.6, 4.8) | 6.0 m |
| Hall 1 | (151.5, 232.7) | (143.3, 231.6) | 8.2 m |
| Hall 6 | (248.0, −277.2) | (251.0, −280.9) | 4.8 m |

With every hall and gate as a reference, no single transform fits better than 10–30 m: the earlier model and the
JSON overlays were an approximate reconstruction. Overlays (routes, pins, walkway graph) can therefore sit metres off
the new buildings.

## How the code sees the new model

`venue-bharat-mandapam.ts` runs right after loading. GLTFLoader turns spaces in node names into `_`; the tables use
the spaced names.

### Node mapping

| Earlier model (code dependency) | New model | Rule |
| --- | --- | --- |
| `PHOTO_HALL_<n> …` / `HALL_<n>`, extras `hall` | `Hall <n> envelope`, `roof`, `vertical cladding bays`, `standing seams`, `roof coping`, `roof seams`, `lower/upper facade band`, `pale roof boundary` (1, 6, 8, 9, 10, 11, 14) | `^Hall (12A\|\d+) ` → `userData.hall` |
| `PHOTO_HALL_2…5 …` | `Halls 2-5 envelope/roof/…` (one block) | split along the bisectors between the hall centres → `Hall 2 …` … `Hall 5 …` |
| `PHOTO_HALL_12 / 12A …` | `Halls 12 and 12A …` (one block) | same split → `Hall 12 …`, `Hall 12A …` |
| `PHOTO_HALL_<n> roof` / `standing seam roof` (interiors, navigation) | `Hall <n> roof` | `venueRole = hallRoof`; seams/coping `hallRoofPart` (cut away with the roof) |
| `PHOTO_HALL_<n> glass entrance` | none | the interior entrance falls back to the existing default |
| `ROOF_LABEL_H<n>`, `ROOF_LABEL_CC`, `ARCH_H<n>_SIGN`, `PHOTO_ROOF_SIGN_BOARD_*` | none (labels come from the map pins) | — |
| `PHOTO_CC*`, `ARCH_CC*` | `Convention …`, `CC roof …`, `BHARAT MANDAPAM facade lettering` | `destinationId = cc` |
| `PHOTO_CC LEVEL <n> floor plate` | none | CC level views do not run (see below) |
| `PHOTO_MUSICAL_FOUNTAIN*` | `Fountain …` | `destinationId = fountain` |
| `PHOTO_GATE_<n> …`, extras `gate_id` | `Gate <n> …`, `Gate4 …`, `Gate6 …` (not paving/roads) | `gate_id = gate<n>` (gate1, 3, 4, 5a, 5b, 5c, 6–11) |
| `PHOTO_GATE_<n> sandstone lintel` (gate downlights) | none | no lintel downlights |
| `PHOTO_PATH_*` (crowd walks) | paved walkways/plazas (`October walkway …`, `Walkway continuous component`, `Plaza slab …`, `Central walkway …`, `October25 pedestrian pavement`) | `pedestrianSurface`; crowd walks along the campus axes on them |
| `SITE_GROUND` (ground, visitor bounds) | ground-category meshes below 1.6 m | `venueRole = ground`; visitor height from a 1 m grid of their tops |
| `OUTER_GROUND`, `CONTEXT_GROUND` (hidden over the globe) | `Ground context` | `contextGround`, hidden the same way |
| `CAM_TARGET` | — | no reader in the code |
| `SUPREME_COURT_METRO_STN`, `PHOTO_ADMIN*` (hidden under site detail) | `Supreme Court …`, `D Block …` | hidden: venue-site-detail.glb draws them (`SITE_northwest-office-*`) |
| `PHOTO_ROADS_*` (legacy context roads) | — | — |
| water basins (`basin`, `water_body`, `reflecting_pool`) | `Fountain water …`, `Cascade <n> water surface`, `Front reflecting basin water`, `LD-WATER BODY` | `venueRole = water` (visitor hazard, animated water) |
| lamps, bollards (emissive diffusers) | `West lawn light head`, `Gate4 lamp head` | light pool positions (no luminous material in the CAD model) |
| planting | `Detailed foliage …` meshes | collide as their bounding box |
| `PHOTO_ITPO*`, `PHOTO_ADMIN*` (ITPO arrival) | `Admin …`, `Administration …`, `Office …` | kept as modelled; the ITPO photo passes are not run |

### Material categories (`architecturalCategory`)

| Category | New materials |
| --- | --- |
| landscape | landscape, Grass / planted terrace, Detailed foliage 0–3 |
| tree_bark | Tree trunks |
| structure | Charcoal roof / canopy, Light structural steel, Canopy warm bronze underside, Gate 9 galvanised painted steel |
| stone | Light stone coping, Agra sandstone · photograph palette, D Block muted buff sandstone, D Block pale stone courses, Forecourt shaft recessed panel, Ventilation grille · pale stone white, Admin curb charcoal, Admin curb ochre yellow |
| glazing | Blue-grey reflective glazing, D Block dark recessed windows |
| service | Admin rooftop equipment off-white, D Block rooftop plant |
| roof | Admin roof pale weathered surface, D Block roof membrane, D Block observed dark roof strips, Hall roof · muted red from drone, Older halls · warm roof finish, Pale metal roof |
| facade | Hall cladding 0–5 |
| water | Fountain water, water, Reflecting pool subdued water |
| basalt | Reflecting pool dark granite |
| paved_ground | Section paving stone 0–3, Convention plaza warm stone 0–3, D Block recessed court paving, circulation, West arrival warm concrete paving.001, Warm paving, Road sidewalk stone 0–3, October24 pedestrian warm stone, October walkway warm stone 0–3, Courtyard paving · pale stone with rose bands, Plaza slab 0–3, Supreme Court compound warm paving.001 |
| road | Main road · asphalt, October24 asphalt road, October reference warm grey road paving, Supreme Court compound vehicle paving.001 |
| road_marking | Pedestrian kerb contrast, Road edge contrast |
| sign | Gate 9 physical sign blue, Gate sign lettering |
| sculpture | West garden sculpture warm gold |

### Site detail and duplicates

The campus is the convex hull of the 279 `Boundary structural post` nodes.

- Outside the campus, venue-site-detail.glb is the surroundings: 270,894 new ground triangles under its roads,
  footpaths, kerbs, walkways and markings are removed (14 meshes fully hidden). Lawns are kept.
- Inside the campus, the new model is the layout: 9,860 triangles of the site-detail roads/walkways (33 meshes) and
  the `SITE_SURFACE_*` Color → Map campus surfaces, drawn for the earlier layout, are removed at run time.
- `Supreme Court …` and `D Block …` (9,042 meshes) are hidden: site detail draws those buildings.

### Passes per model

| Pass | Earlier model | New model |
| --- | --- | --- |
| photo/reference passes (surface detail, Hall 14 reference, reference materials, architectural detail, concourse, canopies, covered floor, ground photos, Hall 6 jets) | run | not run (they patch named nodes of the earlier model) |
| Gate 9 detail asset, ITPO arrival, Gate 9 road finish/paving | run | not run (the CAD model has its own Gate 9 and ITPO office, ~32 m from the asset's) |
| Color / Natural | palette file by material name | Color = the CAD materials; Natural = the same desaturated; site detail keeps its finishes and Map tints |

## Numbers (Node, no WebGL: `node --expose-gc scripts/venue-harness/run.mjs scripts/venue-harness/pipeline.ts <glb> cad|legacy`)

| | Earlier model | New model |
| --- | --- | --- |
| Destinations with meshes | 27 / 27 | 27 / 27 |
| Interior halls fitted | 1–6, 14 | 1–6, 14 |
| Visitor portals | 7 | 7 |
| Collision faces | 644,654 | 696,339 |
| Night light sources | 591 | 210 |
| Crowd routes | 32 | 32 |
| Meshes before batching | 14,468 | 39,037 |
| Model draw calls after batching (+5 site detail) | 450 | 235 |
| Vertices after batching | 2.40 M | 9.56 M |
| Geometry after batching | 83 MB | 189 MB |
| Batching time (Node) | 0.6 s | ~6 s |

The earlier model's column is the raw model without its photo passes, which add meshes in the browser.

## Not working with the new model

| Feature | Why |
| --- | --- |
| CC levels 1–3 (3D floor plan, CC rooms, CC visitor entrance) | measured from `PHOTO CC LEVEL <n> floor plate`; the CAD model has no floor plates or level elevations |
| CC shell cutaway | the shell node names are those of the earlier model |
| Roof labels on halls/CC | no `ROOF_LABEL_*` meshes; the map pins still label |
| Gate lintel downlights, glowing lamp/bollard faces | no lintels or luminous materials; light pools are placed at the 12 lamp heads |
| Gate 9 photographic detail (moving leaves, guards' booth, arrival at Gate 9) | registered to the earlier model; the visitor starts at Gate 6 |
| Hall entrance from a glass entrance node | no such node; the default entrance point is used |
| Exact overlay fit | routes, pins and the walkway graph stay in the earlier frame (residuals above) |
