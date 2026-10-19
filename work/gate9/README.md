# Gate 9 reconstruction

## Shared grey tile flooring — 18 October 2026

`venue-gate9-paving.ts` reuses the existing plaza paving material and its 32 m
campus-aligned texture atlas across the inner court, kiosk base, shelter decks
and parallel passages. Both appearance palettes share the reference material.
The outside approach asphalt and planted areas remain separate. Old bare soil
strip triangles crossing the kiosk court receive the same paving locally.

## Marked office-side parallel passages — 18 October 2026

The marked long side of the office now follows the three 11:03 photographs:
open passage → long planted strip → white curved shelter → second open passage.
`scripts/gate9-parallel-passages.py` applies this local correction after the
earlier entrance work. The existing office, neighboring property, gate and
kiosk-side shelter retain their geometry. Both ends connect to the open court.

References and estimated widths are in
`references/2026-10-18-parallel-passages/README.md`. The editable blend, GLB and
camera manifest were regenerated. `parallel-passages-validation.json` records
clear straight passage rays, 14 roof bays, 30 pillars, unchanged source-venue
hash, and unchanged extents/counts for unrelated entrance meshes.
`venue-itpo-arrival.ts` also skips the old runtime hedge/tree row within this
footprint when the new photo layer is present; otherwise it would obstruct the
office passage after loading. The old fallback remains if that layer is absent.
Preview `?view=gate9-parallel-layout`, `?view=gate9-parallel-office`,
`?view=gate9-parallel-boundary` and `?view=gate9-parallel-reverse`.

## Parking entrance beside the kiosk — 18 October 2026

The user's annotated model view places the parking entrance immediately right of
the red direction kiosk. This supersedes the earlier canopy spanning the office
frontage. The entrance now faces the gate approach at gate-local `d=34`, with a
10 m wide canopy at `a=9..19` extending inward to `d=62`. Its 3.7 m opening,
concrete side walls, fire cabinets, floor and night lights share this placement.
The outside planted strip and yellow/black kerb follow the new side photograph.
The kiosk and office stay fixed; placement and dimensions are estimates.

References: `references/2026-10-18-parking/` (three photographs and the unmarked
model screenshot; the red-arrow instruction was supplied inline in chat).
Inspect `?view=gate9-photo-shelter`, `?view=gate9-photo-shelter-reverse` and
`?view=gate9-shelter-layout`.

## Gate-front and shelter photographs — 17 October 2026

The latest outside-gate photo replaces the low white context blocks with the
long stone neighbouring building on the left, behind a cream boundary wall,
railing and hedge. It is a separate property; the gate opening stays clear.
The kiosk/shelter daylight image and reverse dusk image guide the office-side
curved cream shelter, white supports, low enclosure, open entrance and lighting.
No unseen underground garage is modelled. Dimensions and photo poses are estimates.

Road/property separation correction: the long transverse facade fence was the
wrong alignment. It is replaced by a solid cream wall beside the left edge of
the approach forecourt, tapering toward the approach verge and joining the small
gate post with a short return. The property is behind this wall, not part of the
road. Its height and alignment remain estimated from the user's correction.
The neighbouring building retains the earlier 14 m inward setback.
The right roadside gap now uses the same cream wall, coping, piers and railing,
following the opposite forecourt edge and returning to the fixed gate-side fence.
Both sides leave the driving lane and automatic gate opening clear.

Validation: `photo-correction-validation.json` records browser checks and the old/new performance comparison. Gate crossing passed; no runtime errors. This test session had low FPS with both assets, so smooth performance remains unverified.

Source images: `references/2026-10-17-photo/`. Rebuild with Blender using
`scripts/build-gate9.py`; the correction is in `scripts/gate9-photo-correction.py`.
Review views: `gate9-photo-outside`, `gate9-photo-shelter`,
`gate9-photo-shelter-reverse` (use the existing evening toggle for dusk).


Earlier correction: [Section 1 user annotations](section1-correction.md). Left is the
property boundary, parking is removed here, and marked canopies/pavilion move right.
The earlier garden-side interpretation below is superseded. Kiosk fork asphalt now
matches the connected road. Open `?view=gate9-section1` for the correction overview.

## Latest walkthrough revision — 16 October 2026

The latest video-based revision corrects the garden-side walkway/pavilion placement,
adds external lookout stairs and glazing, rounds planting edges, and adds office
paving, pots, flush drain covers and layered garden trees. A modeled 3.8 m flush
connector and kerb opening keep the pavilion approach clear. Its width and absolute
placement are estimates, not measured accessibility or navigation results.

Halls, hangars, office footprint, avatar, controls and the prior global asphalt finish
are preserved. Local speech recognition was unreliable; no transcript was used as
factual layout evidence. See [timestamped references](references/2026-10-16/README.md).

New views: `gate9-video-office`, `gate9-video-entry`, `gate9-video-turn`,
`gate9-video-lookout`. The turn view inspects the garden; it is not a calibrated
02:12 phone pose. Work is isolated on `codex/gate9-video-reference` from main
`a230875`; the original checkout was not edited by this revision.

See [current verification](verification-video-2026-10-16.md). No test cases run.
Browser access was declined, so application movement, mobile appearance and runtime
performance remain unverified. Records below, including asset sizes, browser captures
and visitor-walk verdicts, describe earlier iterations only.

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
- **Boundary** — either side of the entrance out to 60 m: left, a cream plastered
  wall with black railings on top and a hedge along the road; right, the picket
  fence continues past the mast, then a taller grey wall. The forecourt keeps no
  trees. (The site layer's own perimeter wall is clipped within 24 m of the gate.)
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
# Entrance route correction — 19 October 2026

The latest front and reverse photographs supersede the earlier closed checking
room. The cabin remains between two independent openings, with a 3.4 × 4.2 m
footprint, shallow pitched roof, barred service window, plain maroon side walls
and open front/rear doors. Door clearance accommodates the visitor controller's
1.23 m collision envelope. These dimensions remain photographic estimates.

The right opening is 8 m, the left 7 m. The former raised base across the left
opening is removed. Both boom arms now sit outside their respective gates.
Gate panels swing inward on approach; this is an estimated animation mechanism
chosen to avoid sliding through the cabin. Older assets retain sliding support.

`scripts/gate9-entrance-route.py` adds a continuous, flush worn concrete apron,
repair patches, cracks, joints and inset utility covers only at the entrance and
right turn. It also adds the electrical box, green bin, cone and water container.
The loose pink barricade is moved out of the entry line. The office, existing
canopies and the previously corrected parallel passage layout are retained.
Rebuilding also includes four boundary lamps already present in the earlier
parallel-passages source but absent from the preceding exported asset.

Review views: `gate9-approach`, `gate9-checking-room`, `gate9-entry-reverse`,
`gate9-entry-turn`, `gate9-entry-straight`, `gate9-entry-overview`.
`entrance-route-validation.json` records collision sampling against the exported
model and source venue with the same superseded context hidden as in the viewer.
# Gate and road alignment — latest 19 October correction

The user's two annotated screenshots supersede the tower and cabin placement
described below. `scripts/gate9-alignment-correction.py` shifts the gate openings,
checking room, barrier controls and guards 12 m to the right in gate-local axes.
The tower is now immediately outside the left gate post, centred at a=-8.4,
d=1.6; its stair is reversed to keep the foot inside the boundary and away from
the road. The checking room is 3.4 m wide and 8.4 m deep, retaining the front
doorway at d=-2.1 and extending inward to d=6.3.

The left gate is centred at a=-3.1. Its road continues past the kiosk's left side
and joins the existing outer office passage at approximately campus (-479,-398).
The former tower footprint becomes a planted road margin. The right return
fence is shortened to the moved vehicle opening; loose barricades stay outside
the walking line. All dimensions are editable photographic estimates.

Review `gate9-entry-overview`, `gate9-left-road` and `gate9-left-road-reverse`.
Coordinates are saved in `gate-alignment.json`; collision and preservation
results are in `gate-alignment-validation.json`. Source screenshots are retained
in `references/2026-10-19-alignment/`.

## Continuous grey paving — latest flooring correction

The user's latest request supersedes the entrance's worn-concrete/repair finish.
`prepareGate9Paving` now applies the existing approved grey plaza tile atlas to
all loaded exterior paving: Gate 9's added apron and aligned road, kiosk court,
checking-room floor, shelter decks, office courts, pedestrian promenades and
site footpaths. UVs use the same campus axes and 32 m atlas origin, so material
and joint spacing continue across separately authored pieces. Street asphalt,
landscaped beds, access covers, kerbs and buildings keep their own finishes.
Old concrete patches, repair overlays and independently drawn cracks/joints are
removed from the rendered floor. No circulation positions or dimensions change.

`batchVenue` now leaves meshes beneath hidden ancestors in their original
hierarchy. Previously those obsolete garden/floor meshes could be detached into
visible batches and appear as pale triangular fragments over replacement floors.

Validation: production build passed (existing CSS budget/CommonJS warnings);
48 loaded paved meshes / 21,050 UV vertices align in world space, 13,577 other
meshes retain geometry/material, and six site boundary fades are preserved.
A hidden-parent regression check confirms only visible paving gets batched.
See `flooring-validation.json`; daytime Gate 9 and entire-venue screenshots are
in `tmp/flooring/`. The live viewer performs this finish pass after model loading.
