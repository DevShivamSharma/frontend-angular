# ITPO arrival court — reference extension

Mode: Experience. Preserve the office, curved Convention Centre, parking podium,
Gate 9, halls and existing interface. Uploaded photos establish materials and
relationships, not survey dimensions. Image 3 is the service enclosure; image 4
is the curved facade (the pasted numbering is reversed).

## Direction contract

THESIS: A coherent arrival court joining the existing office drive to the curved
Convention Centre and open parking frontage.

OWN-WORLD: Beige stone, charcoal ribbon glass, grey concrete, clipped green hedges,
upright broadleaf trees and black/yellow kerbs from the photographs.

STORY: Inspect the entrance, sides and back while retaining clear approaches.

FIRST VIEWPORT: Office and drive in front, established curved building and parking
behind. Existing navigation and appearance controls remain.

FORM: Local extension of the established Three.js scene, no new visual identity.
Hidden dimensions and planting positions are conservative estimates.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Implemented handoff — 2026-10-14

This is a local scene extension under the existing design system. Root DESIGN.md,
PRODUCT.md and the design sidecar remain unchanged, consistent with the Gate 9
brief; this handoff records the surface-specific implementation.

- `src/app/home/venue-itpo-arrival.ts` restores the named office court, apron,
  island, separating drive/kerbs and Convention Centre lawn/rear path. It adds
  clipped hedges, upright broadleaf trees, black/yellow kerbs, approach paving
  and the beige service enclosure with recessed terracotta louvres.
- Podium planting follows downward ray hits on the actual curved deck, with
  roots set onto its surface. Local junction trimming removes kerb triangles
  crossing the other road layer while retaining the driving surfaces.
- The curved facade uses cylindrical UVs and a procedural stone finish. Triangle
  winding and normals are corrected; stone and ribbon windows render both
  sides, and glazing retains its separate material assignment. Building vertex
  positions remain fixed.
- `src/app/home/venue-gate9-trim.ts` extends local vegetation clipping through
  the office frontage; perimeter-wall clipping keeps its Gate 9 boundary.
- `src/app/home/venue-viewer.ts` runs the arrival preparation after the optional
  site/Gate 9 layers and before collision extraction/static batching. Preview
  routes are `/?view=itpo-arrival`, `/?view=itpo-parking`, `/?view=itpo-side` and
  `/?view=itpo-back`; the arrival overview also fits narrow viewports.

## Verification and finish

The implementation run passed 11 tests across `venue-surfaces`,
`venue-architectural-detail` and `visitor-collision`. After the final facade
correction, the arrival regression in `e2e/venue-surfaces.spec.ts` passed again:
actual GLB ray checks cover facade/glazing continuity, podium tree support and
sampled walk clearance, with idempotency, preserved building positions and
bounded geometry/batches. The final production `npm run build` passed with the
existing CSS-budget and CommonJS warnings.

The detector returned `[]` once; the final initial browser capture reported no
errors. Side and parking views were recaptured after the facade fix. Evidence
under `.impeccable/review/`: `itpo-arrival.png`, `itpo-parking.png`,
`itpo-side.png`, `itpo-side-color.png`, `itpo-back.png`, `itpo-back-color.png`
and `itpo-arrival-mobile.png`.

Independent finish review accepted the other scoped scene changes and requested
the facade correction. Final verdict: **SHIP for the reviewed facade-fix scope**;
beige stone reads continuously, ribbon glazing remains uninterrupted, and the
broad patches are gone in Natural and Color views. This evidence does not
certify survey accuracy, registered photographic camera positions, a full
interactive walkthrough, performance or editor end-to-end behavior.

## Provenance and maintenance

Uploaded user photos guide appearance; dimensions and planting placement remain
estimates. The 128 × 128 stone `DataTexture` is authored procedurally in code;
no new shipping raster asset was added. Review PNGs are application captures.
The source `src/assets/venue/IITF_2026_ARCHITECTURAL.glb` remains unchanged,
SHA256 `E998EA8716B8FF7A233F49AED65992BDF9D071E93697948BADBEF09DF15E02AC`.

Keep `prepareItpoArrival` idempotent and in its current loading order. Preserve
the exact restoration allowlist, the porch placement below, building footprints and scoped clipping;
recheck real geometry support/clearance after changing planting or source assets.
When modifying facade UVs, normals, winding or materials, rerun the arrival
regression and compare the same side/parking views in Natural and Color modes.

## Confirmed correction — porch on the left wall

The user confirmed that only the front entrance porch should move onto the
building's left side; the upper building stays in its original location. The
previous whole-building +8 m shift and walkway +2 m shift are removed.

The original canopy, two columns, three steps and two planted entrance beds
rotate 90 degrees onto the left facade, centred at campus s=-438, t=-353.45.
Disconnected source solids are identified through welded triangle connectivity;
only their 240 vertices move, while building geometry and object transforms
remain unchanged. Normals/tangents rotate with the porch; original materials,
indices and UVs remain. The source GLB is unchanged on disk.

The middle side-walk planter run and its lamp/bin are removed to create an
entry opening, and the near hedge has a matching break. A raised landing
supports the porch; the porch solids rise by its 0.3 m height. The arrival
camera now shows the clear former front and the new side porch together.
Placement remains photo-guided and unsurveyed. Other roads/buildings stay fixed.

Verification: TypeScript passes; all four venue-surface regressions pass,
including the empty old porch footprint, new side roof, exact moved vertex
count, unchanged building transforms, planter opening and road clearance.
Desktop/mobile captures are itpo-side-porch.png and itpo-side-porch-mobile.png
under .impeccable/review. Browser capture reported no page errors; the user's
active preview tab was refreshed and visually confirmed. Independent finish
review: SHIP for the porch relocation scope, with an open approach and attached
canopy/supports/planters. Earlier entrance-left images are superseded.
