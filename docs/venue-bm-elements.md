# Bharat Mandapam elements in the earlier venue model

The explorer keeps `IITF_2026_ARCHITECTURAL.glb` as its model. A few elements of the Bharat Mandapam CAD model
(`bharat-mandapam.meshopt.glb`, branch `claude/sweet-newton-zhejct`, Git LFS) are copied into a small asset and fitted
onto the matching parts of the earlier model. The navigation, walkway, site-detail and geography JSON files and the
map pins are unchanged.

- Asset: `src/assets/venue/venue-bm-elements.glb` (1.38 MB, meshopt, lossless copy of the source data) and
  `venue-bm-elements.json` (mapping, fits, residuals, footprints).
- Rebuild: `node scripts/extract-bm-elements.mjs <path to bharat-mandapam.meshopt.glb>`.
- Runtime: `src/app/home/venue-bm-elements.ts`, called by the viewer after the Gate 9/ITPO passes and before interiors,
  navigation and batching. If the asset cannot load, the earlier parts stay exactly as before.
- On/off: `VENUE_BM_ELEMENTS` in `venue-bm-elements.ts` (`tunnel`, `forecourt` on; `hall14` off).
- Checks without WebGL: `node scripts/venue-harness/run.mjs scripts/venue-harness/bm-elements.ts [plan.png] [all]`,
  and plans with `node scripts/render-venue-plan.mjs <glb> <out.png> [x0 z0 x1 z1] [m/px] [--match regex]`.

## Mapping

| Element (flag) | New nodes | Earlier part replaced | Cut | Fit (turn, move) | Outline residual mean / max (m) | Size along × across (new / earlier) |
| --- | --- | --- | --- | --- | --- | --- |
| Covered walk with lattice, "tunnel" (on) | `Central canopy remaining solid roof panels`, `… interior continuous soffit`, `… deep fascia`, `Canopy front individual metal grating bars`, `Canopy bent transverse frame`, `Canopy bent bronze side panels with daylight slots`, `Canopy continuous panel bearing`, `Main canopy longitudinal Y fork`, `Recovered native canopy steel column`, `Native canopy ticket-booth wall` (372 nodes, 32.7 k triangles) | `PHOTO_CENTRAL_SPINE continuous canopy columns trusses and gutters`, `PHOTO_VIDEO central spine curved roof`, runtime `REFERENCE_canopy_perforated_infill/panel_frames`, `PHOTO_concourse_stone_column_bases/event_banners`, `ARCH_Pedestrian canopy edge lighting` | inside the new canopy's footprint only | −0.45°, 18.9 m (long axis onto the earlier spine) | 8.7 / 14.5 new→earlier; 21.4 / 67.7 earlier→new | 179 × 43 / 303 × 24 |
| Forecourt garden (on) | `Forecourt shaft N · …` (19 sandstone shafts), `Shaft sandstone coursing`, `Shaft return stone bed joint`, `Forecourt lawn N`, `Forecourt lawn flush stone edge`, `Native seats`, `Stone seat cap`, `Native paving`, `Low planted-bed shrub`, `DWG planting bed`, `Planting bed edging`, `Planted surface` (1,587 nodes, 135 k triangles) | `PHOTO_CENTRAL_GARDEN hedges and trees`, `… raised beds benches and lawns`, `… sandstone display portals` | all of it | 0°, 30.7 m (shaft grid onto the portal grid, campus axes) | 12.9 / 26.5; 16.1 / 36.6 | 188 × 82 / 185 × 93 |
| Hall 14 drum, "amphitheatre" (off) | `Hall 14 envelope`, `roof`, `vertical cladding bays`, `standing seams`, `roof coping` (5 nodes, 3 k triangles) | `PHOTO_HALL_14 …`, `ROOF_LABEL_H14`, `ARCH_H14_SIGN`, `PHOTO_ROOF_SIGN_BOARD_H14`, runtime `REFERENCE_HALL_14 …`, `HALL_14 entrance detail` | all of it | 0°, 12.3 m (roof centre) | 19.2 / 38.3; 17.0 / 30.0 | 144 × 103 / 94 × 85 |

The residual compares the outline of the placed element with the outline of the earlier part it was fitted to.
The tunnel's earlier→new figures are large because the earlier spine is 124 m longer; its two ends stay in place.

## Materials

Every element is drawn with a material of the earlier model, so Natural/Color, rain, night lighting and the
batches behave as for the earlier parts.

| Element | New material → earlier material |
| --- | --- |
| tunnel | Canopy warm bronze underside, Light structural steel → PM_Precinct canopy steel; Charcoal roof / canopy → PM_Video graphite canopy roof; Light stone coping → PM_Precinct limestone |
| forecourt | Agra sandstone → PM_Precinct red sandstone; Forecourt shaft recessed panel → PM_Precinct display recess; Charcoal roof / canopy → PM_Precinct sandstone trim; Light stone coping → PM_Precinct cream coping; Grass / planted terrace → PM_Precinct roof grass; Detailed foliage 0–3 → PM_Precinct clipped planting |
| hall14 | Hall cladding 0–5 → PM_Cladding 0–5; Hall roof → PM_Roof standing seam graphite; Blue-grey reflective glazing → PM_Deep green low E glass; Light stone coping → PM_Ivory coping; Light structural steel → PM_Brushed silver structural steel |

The CAD data is quantized (Int16 positions, Int8 normals) and has no UVs. When an element is attached its geometry
becomes float positions and normals, and gets box-projected UVs in metres where the earlier meshes of the same
material and batch have UVs, so the surface textures tile and the meshes join the existing batches.

## Numbers (Node, earlier model without its browser-only photo passes)

| | Before | After (tunnel + forecourt) | After (all three) |
| --- | --- | --- | --- |
| Draw calls after batching | 422 | 420 | 413 |
| Vertices | 1.76 M | 2.16 M | 2.10 M |
| Visitor collision faces | 527,837 | 651,605 | 625,404 |
| Interior halls / visitor portals | 7 / 7 | 7 / 7 | 7 / 7 |
| Points walkable along the covered walk (every 5 m) | 62 / 62 | 60 / 62 | 60 / 62 |

The two blocked points are a ticket-booth wall and a canopy column of the new walk; the visitor passes beside them.
