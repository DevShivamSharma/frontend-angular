# SelfCare hall annotation repair

Verified on 27 September 2026. Scope: `backend-nest` and `frontend-angular` only.

## All-hall audit and repair

The historical whitelist filtered **icon types**, not hall names, and its effect was shared across halls. After the initial three-hall repair, a full audit found **18 more affected standalone halls with 129 missing icons**, plus missing compasses and stale legends. The annotation-only repair has now been applied to every prepared non-empty source plan.

All **21 halls with source annotations now match all four annotation fields exactly**, with **353 icons total**. A live-API browser regression visits all 21 halls, checks source equality, local SVG responses, rendered icon counts, labels and compass textures, and verifies every amenity card is in-frame and unobscured in both top and perspective views. It passed on 27 September 2026.

The table's before counts were captured after the initial repair of Hall 14FF, Hall 14GF and Hall 8-9-10.

| Hall | Local ID | Before icons | Current/source icons | Verification |
|---|---:|---:|---:|---|
| Hall 1GF | 1014 | 12 | 24 | Exact source match; top + 3D passed |
| Hall 2GF | 1015 | 16 | 25 | Exact source match; top + 3D passed |
| Hall 12 | 1016 | 3 | 4 | Exact source match; top + 3D passed |
| Hall 8-9-10 | 1017 | 8 | 8 | Exact source match; top + 3D passed |
| Convention Center | 1018 | 0 | 1 | Exact source match; top + 3D passed |
| Hall 1FF | 1078 | 12 | 25 | Exact source match; top + 3D passed |
| Hall 2FF | 1079 | 14 | 20 | Exact source match; top + 3D passed |
| Hall 3GF | 1080 | 12 | 21 | Exact source match; top + 3D passed |
| Hall 3FF | 1081 | 12 | 16 | Exact source match; top + 3D passed |
| Hall 4GF | 1082 | 12 | 21 | Exact source match; top + 3D passed |
| Hall 4FF | 1083 | 13 | 17 | Exact source match; top + 3D passed |
| Hall 5GF | 1084 | 14 | 24 | Exact source match; top + 3D passed |
| Hall 5FF | 1085 | 14 | 23 | Exact source match; top + 3D passed |
| Hall 6 | 1086 | 10 | 28 | Exact source match; top + 3D passed |
| Hall 14GF | 1087 | 27 | 27 | Exact source match; top + 3D passed |
| Hall 14FF | 1088 | 22 | 22 | Exact source match; top + 3D passed |
| Hall 11 | 1089 | 8 | 11 | Exact source match; top + 3D passed |
| Hall 12A | 1090 | 5 | 10 | Exact source match; top + 3D passed |
| PNG Nozzle | 1091 | 0 | 0 | Source has no annotations; skipped |
| F&B Vending Point | 1092 | 0 | 0 | Source has no annotations; skipped |
| F&B Outlet | 1093 | 0 | 0 | Source has no annotations; skipped |
| Hall 1A & Hall 1B | 1094 | 2 | 8 | Exact source match; top + 3D passed |
| Hall 2 & 3 | 1095 | 0 | 4 | Exact source match; top + 3D passed |
| HN1 to HN4 | 1096 | 8 | 14 | Exact source match; top + 3D passed |

**Four standalone locations remain unverified because the prepared source data has no reliable mapping:** Branding Sites (1097), Horse Shoe F&B Outlet (1098), Open Area for Aahar (1099), and Hangar 7A (1100). They were not modified. PNG Nozzle, F&B Vending Point and F&B Outlet have empty annotation sources and were skipped. These exceptions mean this report does not claim that all 28 standalone locations have verified annotations.

Before/after database checks confirmed that every non-annotation master-hall field, all **28 saved hall copies**, all **28 layouts**, and all **2,059 stalls** remained unchanged. Only master-hall amenities, markers, compass and legends were repaired. Private full snapshots are in backend-nest/test-results/selfcare-all/.

Evidence: [database audit](selfcare-annotations/all-hall-audit.json), [21-hall rendered scene checks](selfcare-annotations/all-hall-rendering.json), and screenshots of [Hall 6](selfcare-annotations/Hall-6-verified.png), [Hall 1GF](selfcare-annotations/Hall-1GF-verified.png), and [Hall 11](selfcare-annotations/Hall-11-verified.png).

Applied command, from backend-nest:

```powershell
npm run seed:hall-annotations -- --all --apply
```

## Evidence and root cause

1. The supplied detailed Hall 14FF response (source `hallId: 62`) contains 203 areas, 13 helper groups / 22 images, 16 labels, 12 legends, and one compass. The event response has booking metadata and `eventLayoutId: null`; it does not invalidate the base plan. Fixtures are in [backend-nest/test/fixtures/selfcare](../../backend-nest/test/fixtures/selfcare).
2. The first historical data-loss point is `amenities()` / `AMENITY_BY_URL` in `backend-nest/scripts/build-demo-hall-shapes.ts` at commit `8cada5d`. Its whitelist accepted only `toilet-male.svg`, `toilet-female.svg`, `stairs.svg`, and `entry-up.svg`; `if (!kind) return` dropped all 8 emergency exits, water, and circulation. It iterated every image, but rejected unsupported types. That version also omitted compass/legend output and spaced surviving icons around group positions without retaining anchors.
3. Commit `bc0eb1b` already corrected the source importer/builder, but the generated files were still from the earlier converter. A read-only database check confirmed the same stale state on standalone Hall 14FF, local id **1088**: 12 icons, 16 labels, null compass, null legends. All 16 stored labels already exactly matched the supplied source positions.
4. A second, independent visibility issue existed in `Scene3dComponent.frameDistance()` / `planRect()`: camera fitting included annotations but used the entire canvas, including space behind the toolbar/details panel, and ignored near-edge perspective enlargement. Meshes could be in the frustum but obscured by HTML controls or clipped at the foreground edge. The new `framingViewport()` and perspective fit address this without changing hall geometry or annotation coordinates.
5. The supplied planner screenshot is **Hall 14GF**, identifiable by `FOYER-14G` / `T-14GA`; the SelfCare screenshot is **Hall 14FF**. Comparisons below use the same Hall 14FF.

## Pipeline and counts

The current paths preserve sibling fields and image arrays:

`SelfCare row -> importSelfcareLayout / buildPlan -> HallDto whitelist -> validateHallGeometry -> HallRepository / JSONB columns -> HallService.toHallResponse -> planner hall state -> Scene3dComponent.syncHall -> buildAmenityCards / buildExitLabels / buildCompass -> local SVGs`.

| Hall 14FF item | Source | Current normalized import | Stored before | Stored/API after | Rendered after |
|---|---:|---:|---:|---:|---:|
| Helper groups | 13 | 13 anchors | anchors absent | 13 anchors | 13 cards |
| Helper images | 22 | 22 | 12 | 22 | 22 slots |
| Emergency Exit | 8 | 8 | 0 | 8 | 8 |
| Stairs/Elevators | 6 | 6 | 6 | 6 | 6 |
| Toilet (Male) | 3 | 3 | 3 | 3 | 3 |
| Toilet (Female) | 3 | 3 | 3 | 3 | 3 |
| Drinking Water | 1 | 1 | 0 | 1 | 1 |
| Circulation Area | 1 | 1 | 0 | 1 | 1 |
| Text labels | 16 | 16 | 16 | 16 | 16 |
| Compass | 1 | 1 | 0 | 1 | 1 rose + letter |
| Legend entries | 12 | 12 | 0 | 12 | 11 visible; 1 source-hidden |

All source SVG names resolve to existing `frontend-angular/src/assets/images/*.svg`; browser checks confirmed HTTP 200. No icons were invented, no label numbering was synthesized, and labels were never converted into physical openings. Neither the Nest whitelist nor JSON serialization drops these annotations. Legend visibility is applied only to legend rows; helper images and text labels have no visibility flags. The source's three hidden geometry rows remain hidden when freshly imported, and continue to restrict placement.

## Coordinates and complete inventory

Existing source conventions, confirmed by importer tests and the exported geometry, use **20 annotation pixels per metre**. Hall 14FF has source `length=84` along X and `breadth=116` along Y. The conversion is `x = positionX / 20 - 42`, `z = positionY / 20 - 58`. X points right and positive Z points down the plan; the top-down screenshot uses that orientation. Rectangle coordinates are already metres and use centre conversion separately. Helper positions are card top-left anchors, with each array entry retaining its own slot. Bounds for camera framing are separate from placement bounds.

Every group below has the same source, imported, stored and rendered image count. Negative and out-of-floor anchors are retained.

| Group | Source pixels X,Y | Planner anchor X,Z (m) | Images | Contents, source order |
|---|---|---|---:|---|
| 1 | -280, 2000 | -56, 42 | 4 | Stairs/Elevators; Emergency Exit; Toilet (Male); Toilet (Female) |
| 2 | 1730, 650 | 44.5, -25.5 | 2 | Stairs/Elevators; Emergency Exit |
| 3 | 1600, 300 | 38, -43 | 1 | Emergency Exit |
| 4 | 1350, 40 | 25.5, -56 | 2 | Stairs/Elevators; Emergency Exit |
| 5 | 1200, -50 | 18, -60.5 | 1 | Drinking Water |
| 6 | 720, -110 | -6, -63.5 | 1 | Toilet (Male) |
| 7 | 450, -50 | -19.5, -60.5 | 1 | Toilet (Female) |
| 8 | -120, 200 | -48, -48 | 2 | Stairs/Elevators; Emergency Exit |
| 9 | -200, 900 | -52, -13 | 1 | Stairs/Elevators |
| 10 | -120, 680 | -48, -24 | 1 | Emergency Exit |
| 11 | -100, 523 | -47, -31.85 | 1 | Emergency Exit |
| 12 | 1370, 2000 | 26.5, 42 | 4 | Emergency Exit; Stairs/Elevators; Toilet (Male); Toilet (Female) |
| 13 | 800, 2180 | -2, 51 | 1 | Circulation Area |

All 16 labels survive independently, including the three `T-14FC` entries:

| Index | Text | Source pixels X,Y | Planner X,Z (m) |
|---|---|---|---|
| 1 | EE14-2 | -15, 930 | -42.75, -11.5 |
| 2 | EE14-3 | 15, 630 | -41.25, -26.5 |
| 3 | EE14-4 | 240, 220 | -30, -47 |
| 4 | EE14-5 | 1265, 98 | 21.25, -53.1 |
| 5 | EE14-6 | 1520, 360 | 34, -40 |
| 6 | EE14-7 | 1640, 660 | 40, -25 |
| 7 | EE14-9 | 1580, 1830 | 37, 33.5 |
| 8 | T-14FC | 470, 60 | -18.5, -55 |
| 9 | T-14FC | 740, -20 | -5, -59 |
| 10 | T-14FC | 1180, 60 | 17, -55 |
| 11 | T-14FA | 1320, 1925 | 24, 38.25 |
| 12 | EE14-1 | 325, 1915 | -25.75, 37.75 |
| 13 | T-14FB | 325, 1940 | -25.75, 39 |
| 14 | FOYER-14F | 820, 1880 | -1, 36 |
| 15 | GF14-2 | 1185, 2205 | 17.25, 52.25 |
| 16 | GF14-1 | 465, 2205 | -18.75, 52.25 |

[Machine-readable inventory](selfcare-annotations/inventory.json) records every image, slot, anchor and label through import, persistence and the rendered scene. [Rendered scene evidence](selfcare-annotations/rendered-halls.json) includes texture ink, visibility, frustum and HUD-occlusion checks for all three halls.

## Changes and safe data update

- [build-demo-hall-shapes.ts](../../backend-nest/scripts/build-demo-hall-shapes.ts): adds `--annotations-only`, generating annotations without rewriting geometry/demo layouts; exposes conversion for regression tests.
- [hall-annotations.json](../../backend-nest/scripts/data/hall-annotations.json) and [hall-amenities.json](../../backend-nest/scripts/data/hall-amenities.json): regenerated source-derived annotations for 24 known halls. Supplied Hall 14FF JSON overrides the CSV. Hall 8-9-10 uses CSV row 79; unknown hall names are skipped rather than guessed.
- [seed-hall-annotations.ts](../../backend-nest/scripts/seed-hall-annotations.ts) and backend `package.json`: dry-run-first, repeatable update of four JSONB columns only; name/id/dimension checks, ambiguity rejection, row locking, saved-layout exclusion, and no automatic schema migrations.
- [seed-demo-halls.ts](../../backend-nest/scripts/seed-demo-halls.ts): consumes the current annotations, including compass/legends, while retaining its existing geometry source. A subsequent demo-master seed cannot restore the stale annotation subset.
- [scene3d.component.ts](../src/app/planner/three/scene3d.component.ts): fits the hall into the uncovered canvas and accounts for perspective. Existing controls, picking and placement use the same camera projection.
- `selfcare-layout.ts` and its spec: correct the misleading event-layout comment; runtime import behavior is unchanged.
- [backend regression tests](../../backend-nest/src/halls/selfcare-annotations.spec.ts), fixtures, and [browser regressions](../e2e/selfcare-annotations.spec.ts): cover complete groups, repeated labels, coordinates, DTO serialization, safe repairs, local asset loading, textures, legend visibility, HUD occlusion, and real API rendering.

The initial repair applied to standalone local halls **1088 (14FF), 1087 (14GF), 1017 (8-9-10)**. Before/after database comparison proved that **every non-annotation field was unchanged**, and saved copies **1034, 1110, 1111, 1135** were entirely unchanged. No stalls, layouts, dimensions, boundaries, zones, openings or placement rules were rewritten. Private before/after DB snapshots are under `backend-nest/test-results/selfcare/`.

From `backend-nest`, preview and repeat the targeted repair:

```powershell
npm run seed:hall-annotations -- --hall 'Hall 14FF' --id 1088
npm run seed:hall-annotations -- --hall 'Hall 14FF' --id 1088 --apply
```

Use the destination database's local id, not SelfCare's `hallId: 62`. Omit `--id` when there is exactly one standalone hall with that name. Applying all prepared halls requires explicit `--all --apply`. Empty annotation sources are skipped. The full geometry seed and demo-layout refresh were **not run**.

## Screenshots

Before images replay the captured pre-repair **database record** with the current camera; after images use the real Nest API. They show the same hall and preserve the same stored geometry. They are not altered images or API-only proofs.

| View | Before | After |
|---|---|---|
| Hall 14FF top-down | [Before](selfcare-annotations/Hall-14FF-stored-before-top.png) | [After](selfcare-annotations/Hall-14FF-live-top.png) |
| Hall 14FF normal 3D | [Before](selfcare-annotations/Hall-14FF-stored-before-3d.png) | [After](selfcare-annotations/Hall-14FF-live-3d.png) |
| Hall 14GF | ? | [Top-down](selfcare-annotations/Hall-14GF-live-top.png), [3D](selfcare-annotations/Hall-14GF-live-3d.png) |
| Hall 8-9-10 | ? | [Top-down](selfcare-annotations/Hall-8-9-10-live-top.png), [3D](selfcare-annotations/Hall-8-9-10-live-3d.png) |

## Validation and remaining differences

- Nest full suite: **293 tests passed in 13 suites**, including the final demo-seeder regression.
- Angular geometry suite: **114 assertions passed**. The command exited 1 afterward because Windows locked a temporary `dist/test-out/.../polyfills.js` during Karma cleanup (EPERM); no assertion failed.
- Existing browser geometry, planner-rule and stall-editor checks: **64 passed**, covering drawing, dragging, imports, AI previews, splitting, save rejection, mobile controls and placement validation.
- Initial annotation browser suite: **3 passed**, including live API rendering of the first three repaired halls. Hall 14FF has all 13 cards / 22 slots, 16 labels and compass visible in top-down and perspective; both grouped and repeated annotations survive.
- Additional all-hall browser regression: **1 passed**, covering all **21 sourced halls / 353 icons** in top-down and perspective views.
- Production builds: **Nest and Angular passed**. Angular's existing initial-bundle warning and `polygon-clipping` CommonJS warning remain.
- Final camera interaction recheck: **2 passed** (real canvas drawing and dragging).
- Impeccable detector: no findings for the camera change.

The repair deliberately retains existing stored floor/zone geometry. Old imported halls still show their existing curtain/clearance graphics, which can differ from a fresh source import that respects the source's hidden geometry flags. No hidden geometry was forcibly enabled. The existing local `direction.svg` compass artwork is retained, with the source rotation and letter offset. Captions retain the planner's existing plan-scale size and sharpen on zoom. Old saved layouts retain their historical hall snapshots, including historical annotation omissions; they were not overwritten by the master-hall repair.
