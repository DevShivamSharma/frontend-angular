# Bharat Mandapam surroundings and property planting

The supplied aerial image with the red outline is the visual reference. The outline is recorded in `reference.json`, in its original 1918 × 820 image coordinates. Four existing hall centres register that image to the application's metre-based X/Z coordinates. Halls and hangars are read-only reference geometry.

## Editable source and integration

- `bharat-mandapam-surroundings.blend` contains a protected existing-venue reference collection, a nearby infrastructure collection, and a property planting collection.
- `scripts/build-venue-surroundings.py` rebuilds the Blender file and exports only the added collections to `src/assets/venue/venue-site-detail.glb`.
- `road-connections.json` records photo-based repairs and satellite continuations. The Blender builder first runs `scripts/prepare-venue-roads.cjs`, which snaps adjoining ends, splits intersections and unions asphalt/footpath surfaces into `roads-prepared.json`.
- `src/assets/venue/venue-site-detail.json` records the affine registration, residuals, original-model hash, feature inventory and uncertainty.
- `venue-site-detail.ts` loads the added layer before navigation and render batching. Only the superseded exterior office and metro placeholders are hidden. A failed asset load retains the previous scene.
- The near map is suppressed only under replacement roads, building footprints, parking and planted parcels after the layer loads. Landscaping blends near the cropped photo edges; roads continue across those edges and taper only at the outer open ends of the modeled network. Distant geographic context and globe navigation remain available.

Run the asset builder from the frontend project directory:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background --python scripts/build-venue-surroundings.py
```

The original venue GLB is never rewritten. The generated report records its SHA-256 before and after asset authoring. Blender objects retain descriptive feature names; the web viewer batches compatible static meshes to reduce draw calls.

The current layer contains 28 nearby building footprints, eleven connected road sections, an elevated metro station and track, parking detail, 1,388 nearby trees, and supplemental property planting (seven trees and 330 bushes). Plant counts describe generated assets, not verified real-world inventory. The runtime GLB is approximately 9.53 MB; the editable Blender file is approximately 36.76 MB.

## Accuracy and remaining source needs

This is a visual reconstruction, not a 99%-accurate measured digital twin. The four anchor residuals describe the fit to the existing model, not absolute survey accuracy. The supplied red stroke and image cropping are approximate boundaries, not cadastral evidence.

Nearby building footprints, road centre lines, metro alignment, visible parking rows and planting belts are traced from the image. Heights, window rhythm, concealed faces, kerb dimensions, metro access structures, lamp spacing and individual bushes are inferred. Supplemental property shrubs are constrained to the existing low lawn mesh. They are not a count or survey of actual bushes.

Road continuations use the already bundled `satellite-inner.jpg` and its registered corners. The source aerial remains the reference within its crop. Eleven connected road sections include nine junction nodes, a frontage link, residential access connections and an approach near the metro. Junctions share asphalt, with openings in medians and lane markings kept away from junction mouths. Connectivity is authoring topology, not verification of real-world driving permissions, bridge levels or traffic routing.

Completing a measured second phase requires an original high-resolution orthophoto/site survey, elevation data, and close views of the property landscaping, kerbs, signs and street furniture. A higher-resolution satellite reference can refine the outer road alignments and grade separation. Those sources would replace the explicitly estimated feature records without moving the protected halls.

Station identity was cross-checked against [ITPO visitor access information](https://www.itpo.gov.in/visitors/how-to-reach) and [DMRC's Supreme Court station information](https://backend.delhimetrorail.com/documents/5240/updatedsupcourt.pdf). These sources establish context; they do not supply the modeled dimensions. Existing OSM and satellite credits remain in `src/assets/venue/geography/ATTRIBUTION.md`.

No test cases are part of this authoring script or this requested change.
