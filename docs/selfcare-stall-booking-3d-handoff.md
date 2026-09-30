# Selfcare stall booking → 3D planner: integration handoff

Prepared: 2026-09-30. Scope: `app-stall-booking`, related stall geometry/options, and relevant local database snapshot records.

## 1. Read this first

**Hall 12A has a configured 1 × 1 grid and hall dimensions 57 × 115 in the inspected dump. Combined with the supplied frontend analysis, this represents 1 m × 1 m cells in a 57 m × 115 m hall. A real saved 12-cell stall corroborates a 3 m × 4 m footprint at the reported 20 canvas pixels per meter.**

This document is the implementation context for the separate 3D planner. It distinguishes observed database facts from supplied source-analysis claims and proposed adapter behavior. It does not claim that production integration or save/reload testing has been completed.

Evidence levels:

| Label | Meaning |
|---|---|
| **DB verified** | Read directly from the supplied PostgreSQL archive schema/data. |
| **Reported frontend** | From the user's supplied Selfcare analysis, with source references; original Selfcare files were not independently inspected in this workspace. |
| **Planner documented** | From this project's existing `docs/stall-placement-contract.md`; this handoff did not re-audit its implementation. |
| **Proposed** | Adapter design or verification requirement, not an existing implemented capability. |

Database evidence: `C:/Users/Shivam Sharma/Documents/p-db`, PostgreSQL CUSTOM archive, source database name `production`, PostgreSQL/pg_dump version 18.4. Only archive-to-SQL extraction was performed. No database was restored, connected to, or modified. The inspection date is not asserted to be the snapshot creation date.

The archive contains 5,829 stall rows, 73 event-layout rows, and 28 default-layout rows. Counts include inactive rows unless stated otherwise. All 101 inspected layout records have `stallWidth: 1` and `stallHeight: 1`; this is snapshot evidence, not a guarantee for future layouts.

**Environment distinction:** The screenshot is from staging. Its event ID `60fb0781-5145-450d-9a24-a71eb2174ef1` is absent from the extracted event-layout and stall tables. Hall 12A matches, but the screenshot's exact event layout has not been verified. Do not substitute a production event for that staging event.

Machine-readable sanitized evidence and the full sample geometry are in [selfcare-stall-booking-evidence.json](selfcare-stall-booking-evidence.json).

## 2. Hall, units, and coordinate frames

### Hall 12A: DB verified

| Property | Value |
|---|---|
| Hall ID/name | `67` / `Hall 12A` |
| Default-layout ID | `34` |
| `length` / `breadth` | `57` / `115` |
| `layout_data.shape` | `non-circular` |
| `layout_data.stallWidth` / `stallHeight` | `1` / `1` |
| Event layouts for hall 67 | 3, all with the same above dimensions/grid configuration |
| Stall rows for hall 67 | 359 across those 3 events |

### Frontend frame: reported frontend

- `METERS_TO_PIXELS = 20` in the page; child component default is reportedly `10` and is overridden by the page input. Verify the active input before generalizing conversion to another entry point.
- Canvas origin is top-left; X increases right, Y increases down.
- `layout_grid.stallCoords` stores cell top-left positions in canvas pixels.
- `layout_grid.borderCoords` stores drawn line endpoints in pixels and an `isDashed` flag.
- Grid-cell width/height comes from the selected hall layout, not from the stall number.
- Zoom/pan is presentation state. Screen pixels are not automatically canvas coordinates.
- Reported panzoom range is 0.5–2.5, with initial zoom 0.5. Pointer unprojection and snapping must be checked in source before implementing edits.
- Non-clickable regions are reportedly expressed in meters, unlike stall coordinates. Their exact structure has not been verified here.

Reported formulas, with `s = metersToPixels`:

```text
hallWidthPx  = length * s
hallHeightPx = breadth * s
configuredCellWidthPx  = stallWidth * s
configuredCellHeightPx = stallHeight * s
cols = floor(length / stallWidth)
rows = floor(breadth / stallHeight)

// Reported non-circular branch: cells fill the hall exactly.
effectiveCellWidthPx  = hallWidthPx / cols
effectiveCellHeightPx = hallHeightPx / rows
effectiveCellWidthM   = length / cols
effectiveCellHeightM  = breadth / rows
```

Reject zero/invalid row counts in a proposed adapter. Trace which effective dimensions the drawing worker and reload path actually use. For Hall 12A, the configured and effective sizes both evaluate to 1 m; the distinction matters for non-integer hall dimensions. Do not apply the non-circular formula to circular halls without checking that branch.

## 3. Geometry and area interpretation

**DB verified:** every inspected stall's `layout_grid` has keys `area`, `stallCoords`, and `borderCoords`.

```ts
// Observed JSON structure; this is not a complete API DTO.
interface SelfcareLayoutGrid {
  area: string;
  stallCoords: Array<{ x: number; y: number }>;
  borderCoords: Array<{
    x1: number; x2: number;
    y1: number; y2: number;
    isDashed: boolean;
  }>;
}
```

**Reported frontend:** a stall is a selection of grid cells, potentially an irregular polyomino, rather than necessarily one rectangle. Drawing/cutting means selecting cells; an existing-stall split operation was not found in the supplied analysis. Rotation and direct resize were also not reported as supported.

**Proposed geometric import:** reconstruct the union of cell rectangles using the matched layout's effective cell dimensions. Preserve shape, concavities, holes, and disconnected components if present. A bounding rectangle is only a bounding box; use it as the stall footprint only after verifying that the cell union fills it.

For non-overlapping unique full cells:

```text
geometricAreaM2 = uniqueCellCount * effectiveCellWidthM * effectiveCellHeightM
```

Keep `sourceAreaText` separate from `geometricAreaM2`. The supplied frontend analysis reports that area is editable and branding can use a `sqft` label. Do not assume that switching the label performs numeric conversion. Preserve the original string and unit until the source behavior is verified.

**DB verified discrepancy:** 1,123 rows with parseable `sqm` area text have an area number different from their raw cell count. This is not proof of one particular bug or cause, and raw cell count is not a universal area formula. Do not silently replace the saved area with a recomputed one.

## 4. Open sides and pixel offsets

**Reported frontend:** `borderCoords[].isDashed = true` means an open border segment; false means closed. The popup reportedly offers Open/Closed. `no_of_open_sides` is a count, not a directional enum or physical door width.

The reported counter groups dashed vertical segments by X and horizontal segments by Y. For irregular shapes, that algorithm must not be interpreted as a universal FRONT/BACK/LEFT/RIGHT classification.

**DB verified:** the sample has two groups of dashed borders and stored `no_of_open_sides = 2`, consistent with left and bottom openings in its unrotated rectangular footprint.

Drawing artifacts are present in the saved data:

- Sample cell footprint reaches `x = 820`, `y = 1120` pixels.
- Right/bottom drawn border coordinates include `x = 818`, `y = 1118`.
- Thus, some borders are inset by 2 pixels, corresponding to 0.1 m at the reported scale.

Do not build a physically shrunken 3D stall from these border offsets. Preserve raw segments and verify how the original renderer introduces the offsets. A proposed adapter can associate each visual segment with a cell-union edge, but tolerance and normalization rules need source evidence; do not apply a blanket +2 adjustment to every border.

For a verified rectangle at rotation 0, planner directional mapping is:

| Canvas edge | Planner side, using the documented +Z-down convention |
|---|---|
| Top / minimum Y | `BACK` |
| Bottom / maximum Y | `FRONT` |
| Left / minimum X | `LEFT` |
| Right / maximum X | `RIGHT` |

Map to a planner `openSides` entry only when the whole corresponding side is open. Partial openings and irregular boundary segments require richer geometry; converting them to a whole-side flag loses information. An open border does not mean booking status `Available`.

## 5. Real saved stall: worked example

This is a production-snapshot sample, not the screenshot's staging stall. Company/name/description/location fields have been omitted.

| Reference | Observed value |
|---|---|
| Stall ID | `c628b705-85a3-4072-9ac3-ae5bef8f3b2d` |
| Hall ID | `67` |
| Event ID | `c71a3f90-297f-4a40-9517-73d453b110a1` |
| Event-hall ID | `3902499c-24dc-4b7f-b883-2eeded0698c0` |
| Matched event-layout row ID | `5` |
| Distinct cell X coordinates | `760, 780, 800` |
| Distinct cell Y coordinates | `1040, 1060, 1080, 1100` |
| Cells | All 12 combinations of the above X/Y coordinates |
| Saved area | `12sqm` |
| Stored open-side count | `2` |
| Category IDs | `[114, 100]` in PostgreSQL integer-array storage |

Using the reported scale of 20 pixels/meter and verified 1 × 1 grid configuration:

```text
Footprint pixels: X [760, 820], Y [1040, 1120]
Top-left meters:  (38, 52)
Width × depth:   3 m × 4 m
Footprint center, measured from hall top-left: (39.5, 54) m
Geometric area:  12 m²
```

The actual separate `stall_coordinates` JSON is:

```json
{
  "top": 1040,
  "left": 760,
  "width": 61,
  "height": 81,
  "centerX": 790.5,
  "centerY": 910.5
}
```

Its 61 × 81 size differs from the cell union's 60 × 80 extent. Its `centerY` also differs from `top + height / 2`. Across the snapshot, 2,642 of 4,497 numeric image-coordinate records fail the simple center = top-left + half-size check on at least one axis. The reason is unverified; image export transformations or stale values must be investigated. **Use neither this bounding size nor its center as the authoritative physical geometry without that investigation.**

## 6. Mapping to this 3D planner

**Planner documented:** positions are in meters, relative to the hall center. `posX` increases right and `posZ` increases down the plan. `width` and `length` are local X/Z dimensions. `rotation` is clockwise in plan. Front = local +Z. `openSides` is authoritative and `gateSide` mirrors its first element for legacy clients.

See [stall-placement-contract.md](stall-placement-contract.md). The formulas below assume an axis-aligned hall whose centered frame corresponds exactly to the Selfcare hall rectangle; an independently registered venue model or irregular hall may require another transform.

For a point in the Selfcare hall frame:

```text
plannerX = sourcePixelX / s - hallLengthM / 2
plannerZ = sourcePixelY / s - hallBreadthM / 2

sourcePixelX = (plannerX + hallLengthM / 2) * s
sourcePixelY = (plannerZ + hallBreadthM / 2) * s
```

For a rectangular stall, derive its position from the **cell-union center**, not one cell's top-left or `stall_coordinates.centerX/centerY`.

The sample maps to this proposed planner geometry:

```json
{
  "width": 3,
  "length": 4,
  "posX": 11,
  "posZ": -3.5,
  "rotation": 0,
  "openSides": ["LEFT", "FRONT"]
}
```

This is a derived geometry example, not a complete planner save payload. Height is not established by the inspected Selfcare geometry; choose an explicit planner setting and retain its provenance. Do not present a default such as 3 m as a database fact.

Proposed adapter requirements:

1. Keep source IDs distinct from planner-generated IDs: stall, hall, event, event-hall, and event-layout IDs must not be interchanged.
2. Preserve original `layout_grid`, original image coordinates, source layout settings, source scale, saved area text, category array, and nullable option values alongside normalized geometry.
3. Verify an event-specific layout by the relevant hall/event/event-hall relationship. Do not load an arbitrary default layout when an event layout exists; establish the actual fallback behavior from source/API.
4. Preserve a source stall number as source identity metadata. The current planner's documented backend owns numbering; do not force a Selfcare number into its numbering contract without an explicit mapping.
5. Keep irregular stalls intact. If the planner only accepts rectangles, report the unsupported geometry or extend its model; do not silently flatten or split the source stall.
6. Arbitrary rotated or off-grid planner shapes may not round-trip into Selfcare's grid-cell format. Check representability before allowing export.
7. Preserve unknown fields and null/missing distinctions until backend semantics are established. Do not silently turn every missing boolean into false or drop an unknown enum.

## 7. Actual stall database schema

**DB verified:** table is `idp."T_STALLS"`. The following columns/types/nullability/defaults were read from its archive CREATE TABLE statement. `—` means no explicit default in that statement. Foreign keys, uniqueness, indexes, triggers, and permissions were not fully inspected; this is a column contract, not a complete constraint audit.

| Column | PostgreSQL type | Nullable | Explicit default |
|---|---|---|---|
| `id` | uuid | No | `public.uuid_generate_v4()` |
| `stall_name` | varchar(255) | No | — |
| `stall_number` | varchar(255) | No | — |
| `hall_id` | integer | Yes | — |
| `layout_grid` | jsonb | Yes | — |
| `status` | integer | Yes | — |
| `created_at` | timestamptz | No | `now()` |
| `updated_at` | timestamptz | No | `now()` |
| `island_number` | varchar(255) | No | — |
| `description` | text | Yes | — |
| `stall_coordinates` | jsonb | Yes | — |
| `event_id` | uuid | Yes | — |
| `stall_type` | varchar(255) | Yes | — |
| `price` | numeric(10,2) | Yes | — |
| `stall_format` | varchar(255) | Yes | — |
| `event_hall_id` | uuid | Yes | — |
| `no_of_open_sides` | integer | Yes | — |
| `is_marquee_available` | boolean | No | false |
| `booking_status` | varchar(255) | Yes | — |
| `category_id` | integer[] | Yes | — |
| `is_active` | boolean | No | true |
| `is_premium` | boolean | Yes | false |
| `is_blocked` | boolean | No | false |
| `is_fnb_stall` | boolean | No | false |
| `location` | varchar(255) | Yes | — |
| `general_new` | boolean | No | false |
| `is_restricted_for_overseas` | boolean | No | false |
| `is_branding_stall` | boolean | No | false |
| `is_horseshoe_stall` | boolean | No | false |

Observed `booking_status` counts: `Available` 3,289; `Booked` 1,718; `In-Progress` 3; literal text `"null"` 819. The last value is a string, not SQL NULL. Do not silently normalize it into an API enum. `Not-Available` was reported in the frontend enum but was not observed in this snapshot's stall records.

Other relevant tables, exact case:

- `idp."T_EVENT_HALL_LAYOUT_DATA"`: event-specific layout. Integer `id`, `hall_id`, `event_hall_layout_id`; UUID `event_id`, `event_hall_id`; `length`/`breadth` double precision; `layout_data`, `direction`, `legends`, `helper_text`, `exit_labels`, `default_stalls` JSONB; `hall_image_url` varchar(300); creation/update timestamps without timezone. `id`, `hall_id`, and `layout_data` are non-null; the timestamps are non-null with `now()` defaults.
- `idp."T_HALL_LAYOUTS"`: default layouts. Integer `id`, `hall_id`, `status`; UUID `event_hall_id`; `length`/`breadth` double precision; `layout_data`, `helper_text`, `exit_labels`, `direction`, `legends`, `default_stalls` JSONB; creation/update timestamps without timezone. `id`, `layout_data`, `status`, and timestamps are non-null; status defaults to 1 and timestamps to `now()`.

The earlier report's `T_Hall_Layouts` spelling does not match this dump. The observed extra stall columns exist, but this inspection does not establish how or when they were added. Missing entity definitions or migration files do not prove manual ALTER TABLE history or persistence of unknown TypeORM properties.

## 8. Stall dialogs and options: reported frontend inventory

The UI details below are retained from the supplied analysis for follow-up source verification. Database column existence does not independently prove a control's visibility, default, or validation behavior.

| UI field/action | Reported frontend key/behavior | Payload/storage relationship |
|---|---|---|
| Island prefix + suffix | `island.name`, `island.number`; required; prefix derived from hall name; suffix padded to at least 2 chars | Combined `island_number`; reportedly disabled on edit |
| Stall No. | `stallNo`; required | `stall_number` |
| Area | `stallArea`; default cell count, editable, required, min 0 and decimal validation | `layout_grid.area`; `sqm`/branding `sqft` label |
| Company Name | `stallName`; required | `stall_name` |
| Category | `category`; optional multi-select from hall-category API | Frontend sends `category_id`; DB integer[]; GET reportedly exposes `category` |
| Location | `location`; reportedly shown/required for F&B or horseshoe modes | `location` |
| Description | `description`; optional | `description` |
| Marquee | `isMarqueeAvailable`; default false | `is_marquee_available` |
| Premium pricing | `isPremium`; default false | `is_premium` |
| General-new pricing | `isGeneralNew`; default false | `general_new` |
| Overseas restriction | `isRestrictedForOverseas`; default false | `is_restricted_for_overseas` |
| Block booking | `isBlocked`; default false | `is_blocked` |
| Border Open/Closed | Per-segment dashed/solid selection | `layout_grid.borderCoords[].isDashed`; calculated `no_of_open_sides` |
| F&B mode | Reportedly mode-dependent and excludes category 119 | `is_fnb_stall`; category 119's business meaning is not verified |
| Branding mode | Reportedly route fragment `#branding` | `is_branding_stall` |
| Horseshoe mode | Reportedly route fragment `#horseshoe` | `is_horseshoe_stall` |

Reported canvas flow: drag to select cells → worker removes unavailable/non-clickable cells → selected cell group → Book/Mark action → booking dialog → API save → fetch bookings → redraw → separate layout image save.

Reported additional operations: edit, delete with confirmation, remove unsaved selection, copy/clone then drag/snap, border opening changes. Direct existing-stall split/resize and moving an original booked stall were not reported as implemented. Help, legends, Clear/Reset, and role-dependent UI behaviors have not been exhaustively verified by this handoff.

## 9. API contract: reported, not live verified

Use the configured `base_stall` service URL; do not hardcode a production host from the prior report. Resolve environments in the Selfcare source and preserve normal authentication/authorization.

| Operation | Reported request |
|---|---|
| Create | `POST stall` |
| Update | `PUT stall/{stallId}` |
| Fetch hall/event stalls | `GET stall?hallId={hallId}&eventId={eventId}` |
| Delete one | `DELETE stall`, body with hall/event/island/stall identifiers |
| Delete event-hall stalls | `DELETE stall/event-hall/{bookedHallId}`; destructive, not part of this inspection |
| Save image/derived coordinates | `PUT app/grid-image` |
| Create/update event layout | `PUT event-hall-layouts-data?eventId={eventId}&eventHallId={eventHallId}` |
| Update default layout | `PUT hall-layouts` |
| Category options | `getHallCategories(bookedHallId)`; exact URL not established |

Create reportedly sends identity fields, `layout_grid`, `no_of_open_sides`, category IDs and the listed option flags. Dialog update reportedly omits hall/event/event-hall IDs and `no_of_open_sides`, retaining existing geometry while updating area and editable metadata. Border-toggle persistence is a separate path that still needs direct tracing.

The supplied analysis reports that the actual stall CRUD service is unavailable locally. Admin-backend entities/render queries are not proof of the stall API's transformation or validation behavior. The dump proves stored values, not which endpoint produced them.

Verify real response nesting, whether `stall_numbers` is an array or serialized string, ID types, error responses, and default/null handling before implementing an adapter. The prior report contains inconsistent illustrative responses; they are not recorded API fixtures.

## 10. Source verification targets

These paths/line hints are from the supplied frontend report and may move. Search only the component and its direct dependencies. Use this repository's prescribed graph-discovery tools when available.

| Reported source | What to verify |
|---|---|
| `itpo_selfcare/src/app/pages/stall-booking/stall-booking.component.ts:51` and template | Active 20 pixels/meter input and environment/layout selection |
| Same page, around lines 204–273 | Pan/zoom and booking reload |
| `itpo_selfcare/src/app/components/utility/stall-booking/hall-layout/hall-layout.component.ts:384` and around 492 | Hall dimensions and effective cell sizing |
| Same component, around 616–675, 912, 1820–2058 | Pointer conversion, selection, snapping, grouping, booking flow, border offsets |
| `itpo_cms.worker.ts:8–64` (full path not supplied) | Selected-cell and exclusion calculations |
| `itpo_selfcare/src/app/components/utility/stall-booking/book-stall-dialog/book-stall-dialog.component.ts:136` and 192–255, plus template | Area/defaults, every option, create versus edit payload |
| `itpo_selfcare/src/app/components/utility/stall-booking/hall-layout/hall-layout.service.ts:64–90` and 673–690 | Image-coordinate transformation, open-side counting, border update payload |

## 11. Remaining checks before production integration

This document is sufficient to begin a scoped importer/adapter design. The following evidence is still required before calling round-trip integration verified:

1. Independently inspect the Selfcare source paths above, especially active scale, adjusted cell dimensions, pointer transformations and border/image offsets.
2. Obtain the exact staging event data if reproducing the original screenshot is required; do not claim the production sample is that event.
3. Verify the actual stall endpoint's accepted DTOs, response formats, validation, IDs, update semantics and option persistence.
4. Establish how geometric area and editable/billable area should coexist; preserve source values until this decision is explicit.
5. Validate sample round-trip: 12 cells → 3 × 4 m at planner center `(11, -3.5)` → same source cells, IDs, area text and opening semantics.
6. Cover irregular shapes, partial openings, circular layouts, null/string-null statuses, and nonrepresentable off-grid/rotated exports without silent data loss.
7. Use the planner's existing validation and numbering contracts. Imported invalid layouts should be reported for repair, not silently relocated, renumbered or treated as approved production writes.

No application code, production API, database records, or planner rules were changed to create this handoff.
