# Bharat Mandapam elements in the earlier venue model

The explorer keeps `IITF_2026_ARCHITECTURAL.glb` as its model. A few elements of the Bharat Mandapam CAD model
(`bharat-mandapam.meshopt.glb`, branch `claude/sweet-newton-zhejct`, Git LFS) are copied into a small asset and fitted
onto the matching parts of the earlier model. The navigation, walkway, site-detail and geography JSON files and the
map pins are unchanged.

- Asset: `src/assets/venue/venue-bm-elements.glb` (7.9 MB, meshopt, lossless copy of the source data) and
  `venue-bm-elements.json` (mapping, fits, residuals, footprints).
- Rebuild: `node scripts/extract-bm-elements.mjs <path to bharat-mandapam.meshopt.glb>`.
- Runtime: `src/app/home/venue-bm-elements.ts`, called by the viewer after the Gate 9/ITPO passes and before interiors,
  navigation and batching. If the asset cannot load, the earlier parts stay exactly as before.
- On/off: `VENUE_BM_ELEMENTS` in `venue-bm-elements.ts` (all six on).
- Checks without WebGL: `node scripts/venue-harness/run.mjs scripts/venue-harness/bm-elements.ts [plan.png] [all]`,
  and plans with `node scripts/render-venue-plan.mjs <glb> <out.png> [x0 z0 x1 z1] [m/px] [--match regex]`.

## Mapping

All elements keep the CAD model's own colours (vertex colours on three shared finishes: matte, metal, glass), so
they look as in the Bharat Mandapam model. The walk, forecourt, plaza and Hall 14 share one transform (the walk's fit)
and keep their exact CAD arrangement; the amphitheatres are fitted on their own.

| Element (flag) | New nodes | Earlier part replaced | Cut | Fit (turn, move) | Outline residual mean / max (m) |
| --- | --- | --- | --- | --- | --- |
| Covered walk with lattice, "tunnel" (on) | `Central canopy …` (roof panels, soffit, fascia), `Canopy front individual metal grating bars`, `Canopy bent transverse frame`, `Canopy bent bronze side panels with daylight slots`, `Canopy continuous panel bearing`, `Main canopy longitudinal Y fork`, `Recovered native canopy steel column`, `Native canopy ticket-booth wall` (372 nodes, 32.7 k triangles) | `PHOTO_CENTRAL_SPINE continuous canopy …`, `PHOTO_VIDEO central spine curved roof`, runtime `REFERENCE_canopy_*`, `PHOTO_concourse_stone_column_bases/event_banners`, `ARCH_Pedestrian canopy edge lighting` | inside the new canopy's footprint (the earlier spine's ends stay) | −0.45°, 18.9 m (long axis onto the earlier spine) | 8.7 / 14.5 |
| Forecourt garden (on) | `Forecourt shaft N · …` (19 sandstone shafts), `Shaft sandstone coursing`, `Shaft return stone bed joint`, `Forecourt lawn N`, `Forecourt lawn flush stone edge`, `Native seats`, `Stone seat cap`, `Native paving`, `Low planted-bed shrub`, `DWG planting bed`, `Planting bed edging`, `Planted surface` (1,587 nodes, 135 k triangles) | `PHOTO_CENTRAL_GARDEN hedges and trees / raised beds benches and lawns / sandstone display portals` | all of it | as the walk | — |
| Central plaza (on) | `Plaza patterned paving` (rose bands), `Plaza solid slab islands 0–3`, `Vent grille …`, `Pale ventilation louvre blade`, `Shaft white louvre / vent inset / inset top / projecting coping` (1,281 nodes, 575 k triangles) | runtime `SITE_DETAIL_decorative_planters` inside its footprint; laid over `SITE_GROUND`, which stays | inside its footprint | as the walk | — |
| Hall 14 drum (on) | `Hall 14 envelope`, `roof`, `vertical cladding bays`, `standing seams`, `roof coping` (5 nodes, 3 k triangles) | `PHOTO_HALL_14 …`, `ROOF_LABEL_H14`, `ARCH_H14_SIGN`, `PHOTO_ROOF_SIGN_BOARD_H14`, runtime `REFERENCE_HALL_14 …`, `HALL_14 entrance detail`; `PHOTO_CC corrected garden connection …` inside its footprint | all of it | as the walk | — (oval 144 × 103 m, earlier drum 94 × 85 m) |
| Amphitheatre 1 (on) | `North seating / paving band`, `Planting bed edging`, `Planted surface` (93 nodes, 5.7 k triangles) | `PHOTO_VIDEO amphitheatre 1 seating with stair aisles` (stage, guardrails, outer planting stay) | all of it | 0°, 9.9 m (box centre, campus axes) | 3.6 / 6.7 |
| Amphitheatre 2 (on) | `South seating / paving band`, `Planting bed edging`, `Planted surface` (96 nodes, 5.4 k triangles) | `PHOTO_VIDEO amphitheatre 2 seating with stair aisles` (stage, guardrails, planting stay) | all of it | 0°, 9.1 m | 3.6 / 6.6 |

Hall 14's interior and visitor entrance are fitted to the CAD roof (`venueRole: hallRoof`, `venue-interiors.ts`).
Flat parts (paving, lawns, plaza slabs, flush edges) are `venueRole: ground`: they cast no shadow and are not walls
for the visitor (`visitor-collision.ts`).

## Numbers (Node, earlier model without its browser-only photo passes)

| | Before | After (all six elements) |
| --- | --- | --- |
| Draw calls after batching | 422 | 404 |
| Vertices | 1.76 M | 3.25 M |
| Visitor collision faces | 527,837 | 633,893 |
| Interior halls / visitor portals | 7 / 7 | 7 / 7 |
| Points walkable along the covered walk (every 5 m) | 62 / 62 | 59 / 62 |

The blocked points are ticket-booth walls and canopy columns of the new walk; the visitor passes beside them.
The headless Chromium run (software WebGL) loads the explorer with all six elements and the concourse crowd.
