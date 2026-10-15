# Gate 9 reconstruction

Source: six user-supplied photographs, copied unchanged into `references/`.
This is a photo-informed, editable reconstruction, not a measured survey.

## Inside the gate — 16 October 2026

Ten more photographs and a 38 s walking video (frames every 2 s) are in
`references/2026-10-15/` (photos downscaled to 1600 px). They cover the gate from
outside, the direction kiosk just inside, the lane with its fenced parking shelters,
the office-front drop-off with the ITPO barrier sign and ENTRY pavilion, and the
same walk at dusk with the lamps on. `scripts/build-gate9.py` now also builds:

- **Gate** — khaki barred leaves (five rails, close bars), a narrower closed left
  gate, the checking cabin between them (photo `20261015_104444` is taken from
  outside: cabin left of the vehicle gate, which supersedes the 14 October
  "right side" placement), two striped boom barriers (`GATE9_barrier_arm_*`,
  hinged objects the viewer raises), a floodlight mast and a wide asphalt forecourt.
- **Kiosk island** — the lane widens round a red-sandstone kiosk with glazing, CCTV
  and the blue direction board (text transcribed from `20261015_104147`); hydrant
  cabinets; clipped hedges behind the strappy beds; a twin-arm lamp on the bend.
- **Parking** — the red-pier fence continues along the lane; two rows of striped
  barrel shelters behind it with low-poly parked cars (deterministic placement).
- **Office frontage** — granite-sett drop-off, plumeria island with pots, white car,
  cones and chain, blue board, the stainless ITPO barrier sign (nameplate + roundel
  lettering only, no emblem), the ENTRY pavilion with its red wall sign, and the
  arched walkway canopy running towards the gate.
- **Lighting data** — every lamp, floodlight, canopy, kiosk and cabin light is listed
  in `gate9-detail.json` (`lights`); `guards` places three staff; `barriers` records
  the hinges. New camera views: `gate9-kiosk`, `gate9-dropoff`, `gate9-parking`,
  `gate9-walkway`.

Sign textures come from `scripts/gate9-signs.ps1` (Windows GDI+, Arial / Nirmala UI)
into `signs/`. Joining shared leaf/crown meshes now copies the data per collection
(the first export of this extension reached 284 MB because a joined crown mesh was
reused by later joins); the shipping GLB is about 17.5 MB.

Runtime (`src/app/home`): `venue-gate9.ts` opens the leaves and lifts the arms for the
walking visitor *and* for a camera orbiting within 30 m; `venue-night-lights.ts`
turns the diffusers emissive and adds up to 20 real lights at night (the home page
follows New Delhi's clock, 06:30–18:30 IST, until the sun/moon button overrides it);
`venue-rain.ts` plus the overcast sky variant in `venue-sky.ts` give the rain toggle.
Dimensions, spacing and the exact kiosk/parking positions remain estimates.

## Checking room correction — 14 October 2026

The additional user-supplied crop is preserved unchanged at `references/checking-room.png`.
The low cabin on the right of Gate 9 (approaching from outside) has brown vertical cladding, a shallow pitched
charcoal roof, ivory window and door frames, a barred observation window and a
yellow mesh barricade in front. The separate raised lookout is retained. The
3.4 × 3.2 m footprint, hidden sides and roof pitch are estimated from the crop.
The cabin stays outside the 14 m gate opening. No unreadable sign text is invented.

The deterministic builder, editable Blender source, shipping GLB and registration
JSON include this correction. Open `/?view=gate9-checking-room` for its close-up.
The current GLB is 13,130,444 bytes; sizes in the original integration record below
describe the preceding reconstruction. No app control or design-system change is
part of this building correction.

The follow-up placement arrow is preserved at `references/checking-room-placement.png`.
The cabin and its front barricade moved together from gate-local x=-10 m to x=10 m;
the bin moved clear of the cabin. The raised lookout remains on the left.
The close-up camera follows the relocated room. `scripts/build-gate9.py` reproduces
the corrected placement, also saved in the editable Blender source and shipping GLB.

The user also selected this entrance's asphalt for every modeled road.
`src/app/home/venue-road-finish.ts` reuses its embedded texture, color and roughness
on campus drives, Gate 6, surrounding roads and the Gate 9 interior lane, with a
four-metre world-aligned repeat. It runs after the optional site layers load and
before batching/appearance capture. Road-edge fade metadata is retained, while
footpaths, kerbs, planting and painted markings keep their materials. Concrete
lane joints/patches receive the asphalt finish too. The shared texture is retained
in both Natural and Color appearances; the satellite/map backdrop is not edited.

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

- `gate9-reconstruction.blend` (35,808,534 bytes): organized approach, security, interior lanes, canopies, planting, furniture and camera collections, plus `08 Local context reconciliation`. Existing venue is a locked reference collection.
- `../../scripts/build-gate9.py`: deterministic asset builder; run with Blender in background mode. This is an asset-authoring script, not a test runner.
- `../../scripts/gate9-context.py`: prepares retained local context copies from the prior inferred site layer for the builder.
- `../../src/assets/venue/gate9-detail.glb` (13,096,120 bytes): new Gate 9 geometry and the retained local context portions described below. Existing halls/hangars are not exported or replaced.
- `reference.json`: registration, approximate camera positions, dimensions and assumptions.
- The outside connector joins the existing southern frontage road at local coordinates `[-627.798, -321.451]`. Existing office structure and hall footprints stay fixed.
- The loader replaces the previous sandstone gate and procedural ITPO entrance details only after the new asset loads successfully. Materials and geometry are owned by the normal viewer lifecycle.
- Shared old boundary/vegetation meshes are clipped only within the entrance and office-lane footprint at load time. This local runtime correction is separate from the locked source-reference collection in the Blender file.
- Collection `08 Local context reconciliation` copies only `SITE_northwest-office-courtyard-wing_*` and `SITE_northwest-office-link_*`. It clips the positive local `t` side at `-444 m`, caps the cuts and retains 580 mesh objects. Runtime substitutes these retained portions for the two old groups only after successful Gate 9 loading. The rest of the context and original sources remain unchanged. This removes the inferred multistory overlap beside the canopy while preserving the retained office/lane context.
- Export meshes use local origins and 18-bit exponential filtering to preserve thin gate bars, lamp poles and kerbs at the venue's large world coordinates. Re-export with the supplied builder, rather than Blender's default 12-bit meshopt position filter.
- Gate leaves open automatically before an active visitor approaches. Stationary piers, fences, cabins, kerbs and barriers enter the existing geometry collision system; the moving leaves are kept out of static collision/batching.

The venue interface, avatar and existing controls are preserved. Local static previews use [approach](http://localhost:4205/?view=gate9-approach), [gate close-up](http://localhost:4205/?view=gate9-close), [interior lane](http://localhost:4205/?view=gate9-inside) and [canopy](http://localhost:4205/?view=gate9-canopy). See `verification.md` for the final captures and scoped review verdict.

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
