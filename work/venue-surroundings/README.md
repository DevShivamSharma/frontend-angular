# Bharat Mandapam surroundings and property planting

The supplied aerial image with the red outline is the visual reference. The outline is recorded in `reference.json`, in its original 1918 × 820 image coordinates. Four existing hall centres register that image to the application's metre-based X/Z coordinates. Halls and hangars are read-only reference geometry.

## Editable source and integration

- `bharat-mandapam-surroundings.blend` contains a protected existing-venue reference collection, a nearby infrastructure collection, and a property planting collection.
- `scripts/build-venue-surroundings.py` rebuilds the Blender file and exports only the added collections to `src/assets/venue/venue-site-detail.glb`.
- `satellite-reference.json` registers the Esri zoom 18 image (`docs/aerial-reference/bharat-mandapam-satellite-z18-full.jpg` in the parent project) to the venue's X/Z metres. It holds the image pixels and model world positions of the CC, Hall 14, Hall 1 and Hall 6, and the similarity fit (scale, rotation, translation) that `scripts/fit-satellite-reference.cjs` writes back into it. The fit uses the CC, Hall 14 and Hall 6 (residuals under 1 m). Hall 1 is kept as a check: its pixel pick is right, but the model's Hall 1 sits about 20 m from where the other three halls put it, so fitting it would pull the others 4 to 10 m off.
- `road-connections.json` holds every road and walkway centreline, traced on the zoom 18 image in its pixels. `roads` are the public roads (existing ids kept where it is the same road: `southern-frontage` is Mathura Road, `northern-road` is Bhairon Marg east of the railway, `eastern-frontage` is Bhairon Road on the Purana Qila side). `walkways` are the internal service roads (`type: service`, asphalt) and main pedestrian walkways (`type: path`, pale sandstone), traced along the walkable centre and joined at junctions for route lines. The old photo-pixel `roads` in `reference.json` were removed: they came from an AI-generated render and their geometry was wrong.
- The Blender builder first runs the fit script, then `scripts/prepare-venue-roads.cjs`, which converts the traces through the fit, snaps adjoining ends, splits intersections and unions asphalt, footpath, service road and walkway surfaces into `roads-prepared.json`. Walkway paving stops at the road footpaths; a walkway end on a road centreline is recorded as a gate onto that road.
- `scripts/overlay-venue-roads.py` draws the rebuilt `mapMask.roads`, `walkways` and `propertyBoundary` over the zoom 18 image into `docs/aerial-reference/model-roads-vs-satellite-after.png`. Use it to check alignment instead of judging the 3D view.
- `src/assets/venue/venue-site-detail.json` records the affine registration, residuals, original-model hash, feature inventory and uncertainty.
- `venue-site-detail.ts` loads the added layer before navigation and render batching. Only the superseded exterior office and metro placeholders are hidden. A failed asset load retains the previous scene.
- The near map is suppressed only under replacement roads, building footprints, parking and planted parcels after the layer loads. Landscaping blends near the cropped photo edges; roads continue across those edges and taper only at the outer open ends of the modeled network. Distant geographic context and globe navigation remain available.

Run the asset builder from the frontend project directory:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background --python scripts/build-venue-surroundings.py
```

The original venue GLB is never rewritten. The generated report records its SHA-256 before and after asset authoring. Blender objects retain descriptive feature names; the web viewer batches compatible static meshes to reduce draw calls.

The current layer contains 28 nearby building footprints, eleven connected road sections, twenty internal service roads and walkways, an elevated metro station and track, parking detail, 1,371 nearby trees, and supplemental property planting (six trees and 328 bushes). Plant counts describe generated assets, not verified real-world inventory. The runtime GLB is approximately 8.89 MB; the editable Blender file is approximately 35.07 MB.

## Accuracy and remaining source needs

This is a visual reconstruction, not a 99%-accurate measured digital twin. The four anchor residuals describe the fit to the existing model, not absolute survey accuracy. The supplied red stroke and image cropping are approximate boundaries, not cadastral evidence.

Nearby building footprints, road centre lines, metro alignment, visible parking rows and planting belts are traced from the image. Heights, window rhythm, concealed faces, kerb dimensions, metro access structures, lamp spacing and individual bushes are inferred. Supplemental property shrubs are constrained to the existing low lawn mesh. They are not a count or survey of actual bushes.

Roads and walkways are traced on the zoom 18 satellite image, not on the supplied aerial: that aerial is an AI-generated render whose roads have the right character but the wrong geometry. Eleven connected road sections (one component, twelve junctions, six open ends that taper) and twenty internal service roads and walkways are modelled. The walkways form one network plus the Hall 2-5 service yard, which reaches it through the outer roads; five walkway ends are gates onto a road and three end at a building entrance or yard. Widths and medians are measured off the image (about 0.55 world metres per pixel). Junctions share asphalt, with openings in medians and lane markings kept away from junction mouths. Connectivity is authoring topology, not verification of real-world driving permissions, bridge levels or traffic routing; the flyovers and the Mathura Road underpass are not grade-separated.

Nearby building footprints, outside planting parcels and the parking rows are still traced from the supplied render and have not been re-checked against the satellite image.

Completing a measured second phase requires an original high-resolution orthophoto/site survey, elevation data, and close views of the property landscaping, kerbs, signs and street furniture. A higher-resolution satellite reference can refine the outer road alignments and grade separation. Those sources would replace the explicitly estimated feature records without moving the protected halls.

Station identity was cross-checked against [ITPO visitor access information](https://www.itpo.gov.in/visitors/how-to-reach) and [DMRC's Supreme Court station information](https://backend.delhimetrorail.com/documents/5240/updatedsupcourt.pdf). These sources establish context; they do not supply the modeled dimensions. Existing OSM and satellite credits remain in `src/assets/venue/geography/ATTRIBUTION.md`.

No test cases are part of this authoring script or this requested change.
