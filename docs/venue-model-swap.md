# Venue model swap: Bharat Mandapam GLB

Status: **groundwork only.** The new GLB (meshopt, ~238 MB, ~35k nodes, DWG-layer node names) has not been supplied yet, so
every "New model" cell below is open. Nothing is guessed: a row is filled in only after the name or layer is seen in the file.

## One place for the model path

`src/app/home/venue.models.ts` exports `VENUE_MODEL` (`file` plus an optional plain `fallback`) and `PREVIOUS_VENUE_MODEL`.
`venue-viewer.ts` loads `VENUE_MODEL`; going back to the earlier model is `VENUE_MODEL = PREVIOUS_VENUE_MODEL`.
The GLTFLoader already has `MeshoptDecoder` from `three/addons/libs/meshopt_decoder.module.js` (no new dependency).

## Node scripts (no WebGL)

| Script | What it answers |
| --- | --- |
| `node scripts/check-venue-model.mjs <glb>` | file/node/material counts, decoded geometry MB (from accessor sizes), draw-call floor after material batching, how many nodes/materials match each name the code looks for |
| `node scripts/check-venue-frame.mjs <glb> [--map halls.json]` | hall centres vs the explorer frame; best similarity fit (axis choice, mirroring, scale, rotation) with per-hall residuals |
| `scripts/venue-glb.mjs` | shared reader (JSON chunk, world matrices, accessor min/max boxes, meshopt buffer-view decode) |

Frame: world X/Z metres, Y up, east +X, south +Z. `halls.json` is `{ "Hall 14": { "expected": [x, z], "match": "<regex on node name>" } }`.

## What the code looks for in the main model

"Used by" is a file in `src/app/home/`. "New model" stays blank until the file is inspected.

### Selection and views (destination ids)
| Old node / metadata | Used by | Effect if missing | New model |
| --- | --- | --- | --- |
| `userData.destinationId`, `gate_id`, `hall` (glTF node extras; 57 nodes carry `hall`, 105 `gate_id`) | `venue-viewer.ts` `classify` | hall/gate click selection and highlight | |
| `HALL_<id>` / `PHOTO_HALL_<id> ...` (`^(PHOTO_)?HALL_(12A|14|12|11|10|[1-9])[ _]`) | `venue-viewer.ts` `classify`, `venue-architectural-detail.ts` | hall selection, per-hall facade finish | |
| `ROOF_LABEL_H<id>`, `ROOF_LABEL_CC` | `venue-viewer.ts` (classify, batching semantics), `venue-interiors.ts` | label pick, interior roof cutaway | |
| `ARCH_H<id>_SIGN`, `ARCH_CC_SIGN`, `PHOTO_ROOF_SIGN_BOARD_H<id>/CC` | `venue-viewer.ts`, `venue-reference-hall14.ts`, `hall14-detail.ts` | sign pick/colour | |
| `PHOTO_CC*`, `PHOTO_Swept*`, `PHOTO_Ramp*` | `venue-viewer.ts` (classify, `ccMaterials` clipping), `venue-architectural-detail.ts` | CC selection; CC level cut-away clipping | |
| `PHOTO_MUSICAL_FOUNTAIN*` | `venue-viewer.ts`, `venue-reference-concourse.ts` | fountain selection, shelter roof | |
| `cc_level` (extras, 6 nodes) | `venue-viewer.ts`, `venue-batching.ts` | CC level 1-3 floor-plan views | |
| `source_object` in `venue-navigation.json`: `HALL_<n>`, `PHOTO_GATE_<n> sandstone lintel` | `venue.models.ts` type; gate lights in `venue-light-sources.ts` | gate lintel downlights | |

### Interiors, walk, collision
| Old node / metadata | Used by | Effect if missing | New model |
| --- | --- | --- | --- |
| `PHOTO_HALL_<id> roof` (`standing seam roof` for 1 and 14), `PHOTO_HALL_<id> glass entrance`, `ROOF_LABEL_H<id>` for ids 1-6, 14 | `venue-interiors.ts` `measureInteriorHalls` | no hall interiors (roof fit and entrance) | |
| `PHOTO_HALL_<id> ... roof` regex | `visitor-navigation.ts` | hall footprints for walking | |
| `SITE_GROUND`, `CONTEXT_GROUND`, `OUTER_GROUND`, `LAWNS`, `asphalt`, `paving`, `lane marking`, `edge inlay`, water/cascade names | `visitor-collision.ts`, `visitor-navigation.ts`, `venue-batching.ts`, `venue-viewer.ts` | ground height and what blocks the visitor | |
| `PHOTO_GATE_6 ... fence_panels / pickets_and_rails` | `visitor-collision.ts`, `visitor-portals.ts` | Gate 6 entrance carving | |
| `Inner perimeter plinth`, `Interior facade lining` (`VISITOR_ENTRANCE_LINING`) | `visitor-collision.ts`, `visitor-portals.ts`, `visitor-doorway.ts` | doorway lining carve | |
| `GATE9_moving_leaf_*`, `GATE9_barrier_arm_*` | `visitor-collision.ts`, `venue-gate9.ts` | these live in `gate9-detail.glb`, not the main model | n/a |

### Surroundings, site detail, roads
| Old node / metadata | Used by | Effect if missing | New model |
| --- | --- | --- | --- |
| `SUPREME_COURT_METRO_STN`, `PHOTO_ADMIN*` | `venue-site-detail.ts` (hidden as `supersededBySiteReference`) | duplicates under the site-detail surroundings stay visible | |
| `PHOTO_PATH_<name>` x8: Eastern perimeter service drive, Gate 10 north campus approach, Gate 11 forecourt connector, Hall 1 rear service drive, Hall 6 north approach, Hall 6 south and Gate 1 approach, Hall 12A east service link, Hall 14 to exhibition plaza drive | `venue-site-detail.ts` `SUPERSEDED_DRIVES`, `venue-pedestrians.ts` | duplicate drives; crowd walk lines. 0 nodes of this name in the old main GLB, they come from `venue-site-detail.glb` | |
| `PHOTO_ROADS_asphalt_network`, `PHOTO_ROADS_lane_markings`, `PHOTO_ROADS_perimeter_kerbs` | `venue-edge-detail.ts` `LEGACY_CONTEXT_ROADS` | legacy roads under mapped roads | |
| `OUTER_GROUND`, `CONTEXT_GROUND` (hidden when the globe is present) | `venue-viewer.ts` | placeholder slabs hide the satellite/map | |
| `SITE_GROUND` | `venue-itpo-arrival.ts`, `venue-road-finish.ts`, `visitor-*` | ground reference | |
| `CAM_TARGET` | no reader found in `src/app/home/` | none | |
| `PHOTO_ADMIN` list in `venue-itpo-arrival.ts` (office ground court, pedestrian apron, front planted island, CC west tapered lawn, office to CC separating drive (+kerbs), CC rear pedestrian path) | `venue-itpo-arrival.ts` | restored after hiding | |

### Photo-reconstruction detail passes (name regexes)
These patch specific hand-built nodes of the old model. A CAD export is unlikely to have them; the passes either no-op or must be switched off.
| Old names | Used by |
| --- | --- |
| `PHOTO_ITPO office sandstone structure / entrance planting`, `PHOTO_CC ITPO side ribbon windows and joints / curved stone drum`, `PHOTO_CC elevated podium deck`, `18 Photo parallel office passages` | `venue-itpo-arrival.ts`, `venue-gate9.ts` |
| `PHOTO_GATE_9 *`, `GATE_9_SIGN_*`, `SITE_northwest-office-*` | `venue-gate9.ts` |
| `PHOTO_CENTRAL_SPINE_*`, `PHOTO_GARDEN_TO_FOUNTAIN_*`, `PHOTO_HALLS_corrected_covered_approach*`, `PHOTO_VIDEO_*_curved_roof`, `PHOTO_covered_walk_continuous_paving` | `venue-reference-canopy.ts`, `venue-reference-concourse.ts`, `venue-ground-photos.ts` |
| `PHOTO_concourse_*`, `PHOTO_hall_entrance_*`, `PHOTO_ground_concourse_details` | `venue-ground-photos.ts` (these are created by code) |
| `PHOTO_HALL_14 *`, `HALL_14`, `ARCH_H14` | `venue-reference-hall14.ts`, `hall14-detail.ts` |
| Hall 6 `triangular basin` node, `spill` / `falling water` | `venue-water.ts` |

### Materials
| Old material metadata | Used by |
| --- | --- |
| `userData.architecturalCategory` on all 146 materials (`glazing`, `water`, `road`, `paved_ground`, `context_ground`, `roof`, `stone`, `plinth`, `roof_label`, ...) | 22 reads in `venue-viewer.ts`, `venue-architectural-detail.ts`, `venue-rain.ts`, `venue-reference-*.ts`, `venue-itpo-arrival.ts`, `venue-road-finish.ts`, `venue-water.ts`, ... |
| Names: `PM_Cladding <n>`, `PM_Ivory aluminium fascia`, `Deep green low E glass`, `Agra sandstone`, `red sandstone course`, `PM_Precinct limestone`, `GATE_PATH pedestrian paving`, `PM_CC aerial limestone paving`, `ITPO arrival grey concrete`, `grass|green|turf` | `venue-reference-materials.ts`, `venue-architectural-detail.ts`, `venue-gate9-paving.ts` |
| Light materials: `diffuser`, `kiosk glazing`, `ENTRY sign`, `recessed line lights` | `venue-light-sources.ts`, `venue-night-lights.ts` |
| **Color mode**: every material of the main model is matched **by name** to `venue-colour-materials.glb` | `venue-appearance.ts` (`wanted.has(definition.name)`, `palette.get(natural.name)`) |

Color mode and `architecturalCategory` are the largest dependency: DWG-layer material names will not appear in
`venue-colour-materials.glb`, and CAD materials carry no `architecturalCategory`.

## Other files that read the old GLB (tests and tools, not run here)
`e2e/*.spec.ts` (`venue-interiors`, `cc-interiors`, `venue-surfaces`, `venue-architectural-detail`, `venue-edge-detail`, `home-map-data`, `home-model`, `venue-reference-concourse`, `visitor-fixture`),
`scripts/build-gate9.py`, `build-venue-surroundings.py`, `build-venue-walkways.cjs`, `extract-hall14.cjs`, `restore-nearby-map.cjs`, `compress-venue-models.mjs`, `build.cjs`.
`npm run build` runs `compress-venue-models.mjs` on the old GLB (needs `meshoptimizer`, which is not in package.json); `npx ng build` skips it.
