# Gate 9 reconstruction

Source: six user-supplied photographs, copied unchanged into `references/`.
This is a photo-informed, editable reconstruction, not a measured survey.

## Viewpoint interpretation

| Photo | Interpretation | Shared evidence |
| --- | --- | --- |
| 5 | Outside, looking towards the entrance | Silver gate, small red security booth, raised lookout, office ribbon windows, yellow and pink barriers |
| 2 | Close oblique view of the closed gate | Silver frame, twisted middle balusters, green bin, damp concrete, office behind |
| 6 | Inside, looking along the office-side lane | Office on right, planted kerbs, narrow covered walkway ahead |
| 1 | Looking back along the internal bend | Office on left, broad cream canopy on right, single-arm lights, strappy planting |
| 4 | Adjacent/reverse canopy court | Cream roof, low stained wall, red fence piers, black railings and curved planted edge |
| 3 | Possible outward approach view; direction and provenance unconfirmed | Road, barriers, white fence; image carries an “AI-generated content” watermark |

Working sequence: **5 → 2 → 6 → 1 → 4**. These are approximate spatial relationships, not verified consecutive camera locations. Photo 3 was not used to create its distant dome or any unique landmark.

## Editable source and integration

- `gate9-reconstruction.blend`: organized approach, security, interior lanes, canopies, planting, furniture and camera collections. Existing venue is a locked reference collection.
- `../../scripts/build-gate9.py`: deterministic asset builder; run with Blender in background mode. This is an asset-authoring script, not a test runner.
- `../../src/assets/venue/gate9-detail.glb`: exported Gate 9 geometry only; existing halls/hangars are not exported or replaced.
- `reference.json`: registration, approximate camera positions, dimensions and assumptions.
- The outside connector joins the existing southern frontage road at local coordinates `[-627.798, -321.451]`. Existing office structure and hall footprints stay fixed.
- The loader replaces the previous sandstone gate and procedural ITPO entrance details only after the new asset loads successfully. Materials and geometry are owned by the normal viewer lifecycle.
- Shared old boundary/vegetation meshes are clipped only within the entrance and office-lane footprint at load time. This local runtime correction is separate from the locked source-reference collection in the Blender file.
- Export meshes use local origins and 18-bit exponential filtering to preserve thin gate bars, lamp poles and kerbs at the venue's large world coordinates. Re-export with the supplied builder, rather than Blender's default 12-bit meshopt position filter.
- Gate leaves open automatically before an active visitor approaches. Stationary piers, fences, cabins, kerbs and barriers enter the existing geometry collision system; the moving leaves are kept out of static collision/batching.

## Information still needed

1. Gate opening width and height, plus one measured road width. Current opening is **estimated at 14 m** and leaf height at **4.4 m**.
2. A straight-on full-width Gate 9 photograph and a marked aerial showing the camera positions and entrance bearing.
3. Continuous photos/video from the outside junction through the gate to the office lane, including the left and right turns.
4. Wider photographs behind each canopy, of the boundary tie-ins and any security cabin sides currently hidden.
5. Close-ups of small signs if their exact text must be included; unreadable text is omitted.
6. Confirmation whether photo 3 is an actual photograph with a watermark or AI-edited imagery.

Road/canopy widths, plant spacing, concealed surfaces and camera calibration remain estimates. The original office's exact façade details are limited by its existing geometry. Transient vehicles and people are not copied. No claim of 100% accuracy is made.

Procedural concrete/asphalt texture PNGs are authored by the builder from deterministic noise, embedded in the GLB and packed into the Blender source. They are not extracted photographic textures.

No test cases were requested or run for this task. Build results and visual-review evidence are recorded separately.
