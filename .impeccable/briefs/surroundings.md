# Bharat Mandapam surroundings and property planting

Recorded 2026-10-12. Surface: the existing venue home's 3D scene and its editable Blender surroundings asset.

## Scope and direction

The user requested nearby roads, metro infrastructure, buildings and landscape from a supplied 1918 × 820 aerial with a red property outline, followed by bushes and detail within the property. Halls and hangars must remain unchanged. The requested 99% accuracy is an aspiration; the current evidence does not establish that accuracy.

The road follow-up requested connection of all outer roads using the earlier aerial and offered satellite imagery. The implementation uses that aerial within its crop and the already bundled, registered `satellite-inner.jpg` for continuations.

This is an Experience extension led by the existing code and venue model. Preserve the venue and warm pale/charcoal square controls. No concept roll or compositional mockup was used. Root `DESIGN.md` governs planner/scoped pricing controls, not this venue surface; it, its sidecar and the visitor brief remain unchanged.

## Source and accuracy boundary

`work/venue-surroundings/reference.json` retains the aerial's pixel coordinates, property outline, traced features and estimates. Four fixed anchors—the convention centre and Halls 14, 1 and 6—register it to world coordinates. The affine fit keeps source halls fixed; its residuals describe fit to the model, not survey accuracy.

Footprints, road centre lines, metro alignment, parking rows and planting belts are traced. Heights, concealed façades, windows, roof services, widths, kerbs, lights, metro access and individual plants are estimated. The red stroke and crop are visual boundaries, not cadastral evidence. This is a visual reconstruction, not a measured digital twin.

The original source GLB remains unchanged. `src/assets/venue/venue-site-detail.json` records `protectedSourceUnchanged: true` and source SHA-256 `e998ea8716b8ff7a233f49aed65992bdf9d071e93697948badbef09df15e02ac`.

## Editable deliverables and integration

`work/venue-surroundings/bharat-mandapam-surroundings.blend` contains three distinct collections:

- `00 EXISTING VENUE — protected reference`: imported source geometry, protected from selection. Halls and hangars are not rebuilt or moved.
- `01 NEARBY — roads, buildings and metro`: the added exterior infrastructure and landscape.
- `02 PROPERTY — supplemental planting`: additions constrained to the existing property lawn geometry.

`scripts/build-venue-surroundings.py` regenerates the Blender source, exports only additions to `src/assets/venue/venue-site-detail.glb`, and writes the registration/inventory report. It first invokes `scripts/prepare-venue-roads.cjs`, using `work/venue-surroundings/road-connections.json` to snap adjoining ends, split intersections and prepare unioned road surfaces. `scripts/frame-venue-surroundings.py` saves an aerial view and sun setup. The current added GLB is approximately 9.53 MB; the Blender source is approximately 36.76 MB.

The current generated inventory contains 28 nearby building footprints, eleven road sections, an elevated metro station and track, parking detail, 1,388 nearby trees, seven supplemental property trees and 330 property bushes. The road authoring data has nine junction nodes, 84 segments and one connected component. These counts describe authored assets and topology, not surveyed quantities or verified real-world traffic routing.

`src/app/home/venue-site-detail.ts` and `venue-viewer.ts` load additions before navigation construction and batching. After success, only superseded `PHOTO_ADMIN*` office and `SUPREME_COURT_METRO_STN` placeholders are hidden. Load failure retains the prior context.

`src/app/home/venue-globe.ts` uses an expanded two-channel mask beneath replacement parcels, buildings, parking and roads to suppress duplicate map roads. Landscaping retains continuous fading near the photo crop. Roads remain visible across that crop and taper only at the modeled network's outer open ends.

## Geometry and landscape rules

Buildings preserve traced silhouettes and courtyard holes, with estimated extrusions, parapets, recessed windows and roof services. Southwest institutional walls use sandstone; other nearby walls use warm limestone.

Roads use unioned asphalt, footpaths, kerbs and medians, with shared junction surfaces, median openings and lane-marking clearances at junction mouths. The connected sections include frontage links, residential access and a metro approach. Actual driving permissions, grade separation and source fidelity remain unverified. The metro adds a viaduct, piers, rails, platform, glazing and a curved silver canopy with pitched ribs; stairs and lifts are estimates. Parking retains traced rows, planting strips and bay markings.

Outside planting follows photographed parcels. Shared three-lobe crowns, three leaf variations, uneven seeded clusters and openings form woodland over dark planted ground. Placement excludes the property, buildings, parking and road clearances. Retain the corrected varied broad canopies rather than a regular orchard grid.

Inside the property, ray-casting constrains additions to low existing lawn/turf/grass surfaces, rejecting roofs and pavement. Low bushes and occasional trees follow reference belts; shrub borders follow genuine welded lawn boundaries, never interior triangulation edges. Preserve halls, routes and door approaches.

## Material character

The authored material palette comes from `scripts/build-venue-surroundings.py`, not new UI tokens:

| Element | Implemented material role |
| --- | --- |
| Ground and vegetation | Dark olive planted ground, deep/mid/young green crown variants, brown bark, muted clipped turf and earth |
| Roads and circulation | Weathered charcoal asphalt, warm concrete footpaths, pale kerb stone and ivory markings |
| Nearby buildings | Warm limestone walls, weathered neutral roofs, sandstone for southwest institutional masses |
| Metro and fittings | Blue-grey recessed glazing, silver canopy, charcoal metal and softly emissive warm lamp diffusers |

Most materials are matte (roughness 0.85); glazing and canopy use lower roughness and modest metallic values. These are local 3D materials, not global UI tokens.

## Review evidence and current status

The initial surroundings correction frames are:

- `.impeccable/review/site-final-desktop-natural.png`
- `.impeccable/review/site-final-desktop-color.png`
- `.impeccable/review/site-final-mobile-color.png`

The finish verdict was **“Ship at this correction scope.”** Woodland was resolved in the first correction and residual edge stippling in the second. Approval covers those corrections in the final views; the reviewer could not verify original-aerial fidelity or 99% accuracy.

The road follow-up frames are `.impeccable/review/roads-desktop-natural.png`, `roads-desktop-color.png` and `roads-mobile-color.png` in the same review directory. The fresh road finish review gave **SHIP at visible-continuity scope**, with no material fixes required. The original aerial was not locally available to the reviewer, and the phone crop does not expose every junction; the verdict does not certify geographic fidelity.

TypeScript and production builds passed with existing planner warnings; the detector returned no findings and the reviewed console was clean. The first sandbox production attempt failed at font DNS resolution; a network-enabled retry passed without source configuration changes. No test cases were run, per user instruction. Navigation, night rendering and performance were not verified by these reviews.

Property planting and connected outer-road topology are implemented. A measured second phase still requires the original high-resolution orthophoto/site survey, elevations and close views of landscaping, kerbs, signage and street furniture. Higher-resolution satellite evidence can refine outer alignments and grade separation without moving protected halls.

## Maintenance boundary

Revise the reference/road-connection JSON and authoring scripts, retain uncertainty in the report, and rebuild only the added GLB. Preserve the venue source and UI. This brief governs the surroundings surface only.
