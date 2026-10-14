# Gate 9 integration record

- TypeScript compilation completed successfully (`npx tsc --noEmit -p tsconfig.app.json`).
- Production build completed successfully (`npm run build`). Existing planner CSS budget and CommonJS `polygon-clipping` warnings remain.
- The final precision-preserving GLB and its registration JSON were copied into the compiled production assets after export.
- No unit, end-to-end, movement or other test cases were run, as requested. Collision and gate-opening integration were inspected in source; visitor traversal is not claimed as runtime-tested.
- Original venue SHA-256 remained `e998ea8716b8ff7a233f49aed65992bdf9d071e93697948badbef09df15e02ac`.
- The Gate 9 GLB is 13,096,120 bytes; the editable Blender source is 35,808,534 bytes. Thin metalwork uses mesh-local origins and 18-bit meshopt filtering. The default 12-bit filter was unsuitable for the original absolute campus coordinates.
- The GLB includes new Gate 9 geometry and retained portions of only `SITE_northwest-office-courtyard-wing_*` and `SITE_northwest-office-link_*`. `scripts/gate9-context.py` clips the positive local `t` side at `-444 m`, caps the cuts and retains 580 mesh objects in `08 Local context reconciliation`. Runtime substitutes those two groups only after successful Gate 9 loading. Other context and original sources remain unchanged; halls/hangars are not exported or replaced.
- The Impeccable detector ran once earlier on the new loader and returned `[]`; it was not rerun after the context correction. It is not a 3D fidelity or navigation verifier.

## Final static evidence

Captures are under `.impeccable/review/` at the project root:

| Capture | Viewport |
| --- | --- |
| [gate9-approach-desktop.png](../../.impeccable/review/gate9-approach-desktop.png) | 1280 × 720 |
| [gate9-close-desktop.png](../../.impeccable/review/gate9-close-desktop.png) | 1280 × 720 |
| [gate9-inside-desktop.png](../../.impeccable/review/gate9-inside-desktop.png) | 1280 × 720 |
| [gate9-canopy-desktop.png](../../.impeccable/review/gate9-canopy-desktop.png) | 1280 × 720 |
| [gate9-mobile.png](../../.impeccable/review/gate9-mobile.png) | 390 × 844 |
| [gate9-user-676.png](../../.impeccable/review/gate9-user-676.png) | 676 × 681 |

The finish reviewer initially found a multistory overlap at the canopy. After the bounded context correction, the verdict was **“Resolved — ship at this reviewed scope.”** The updated cream roof, open supports, fence and court read as a separate shelter; the foreground multistory overlap was removed, and the office/lane remained intact. The 676 px capture confirmed that correction. The reviewer accepted the substitution of only the two named inferred groups with their capped, retained portions and required no further correction for this finding.

This is a scoped static visual and integration record. It does not certify complete photographic accuracy, visitor traversal, gate-opening behavior in motion or runtime performance. No test cases were added or run.

See `README.md` for missing dimensions, camera registration and photo-provenance questions.

## Checking-room correction — 2026-10-14

The photo-guided checking room now has a low brown ribbed cabin, pitched dark roof, ivory grilled window, right-side glazed door and yellow barricade at Gate 9. Its footprint is estimated at 3.4 × 3.2 m. The user reference is preserved unchanged at `references/checking-room.png`; these dimensions are inferred, not surveyed.

- `scripts/build-gate9.py` regenerated the editable Blender source and GLB. The updated GLB is 13,130,588 bytes, superseding the earlier size above. The export report confirms the original venue source SHA is unchanged.
- `src/app/home/venue-viewer.ts` fits the `?view=gate9-checking-room` inspection camera responsively. The final `npm run build` passed with the pre-existing CSS budget and CommonJS warnings.
- Production-app static captures: [desktop, 1440 × 1000](../../.impeccable/review/gate9-checking-room/desktop.png) and [mobile, 390 × 844](../../.impeccable/review/gate9-checking-room/mobile.png). The accompanying [runtime record](../../.impeccable/review/gate9-checking-room/runtime.json) reports `errors=[]` and `overflow=false`.
- The independent finish reviewer returned **SHIP**, with no blocking issue in the building addition. Desktop visibility was adequate; on mobile, the cabin appears smaller behind the existing foreground barriers.
- The detector returned `[]` for the Python builder; this is not evidence of 3D fidelity. No visitor movement tests were run. This review covers the static correction and does not certify navigation or runtime performance.

This asset-specific correction introduces no design-system changes. The existing README documents the correction; global design documentation is unaffected.

## Checking-room relocation and shared road finish — 2026-10-14

The low checking cabin moved to the right side of Gate 9, from gate-local `a=-10` to `a=+10`. Its barricade moved the same 20 m, and the bin shifted from `a=8.2` to `a=12.3`; the lookout stayed in place. The builder, editable Blender source, exported GLB and JSON close-up camera were updated. The current GLB is 13,130,444 bytes, superseding the earlier sizes above.

- `src/app/home/venue-road-finish.ts` runs after `prepareItpoArrival` and before batching. It shares Gate 9's weathered asphalt texture, color and roughness across road-category/asphalt materials and the Gate 9 concrete driving lane, patches and joints. World-aligned UV1 coordinates use `(x/4, -z/4)`. Per-original-material variants share the texture, preserve `siteRoad`/`siteDetail` fades and use distinct names to retain the finish against the Color palette. Footpaths, markings and lawns are unchanged.
- The final `npm run build` passed outside the sandbox after two opaque sandbox failures. Existing CSS budget and CommonJS warnings remain. Isolated Node checks passed for shared texture, mixed-material protection, original geometry and UV0 preservation, texture scale, layer metadata, idempotence, missing-Gate-9 fallback and palette identity.
- Reviewed Natural-mode captures: [desktop, 1440 × 1000](../../.impeccable/review/gate9-road-finish/desktop.png), [mobile, 390 × 844](../../.impeccable/review/gate9-road-finish/mobile.png), [checking room](../../.impeccable/review/gate9-road-finish/gate9-checking-room.png), [Gate 6 road](../../.impeccable/review/gate9-road-finish/gate6-road.png) and [ITPO arrival](../../.impeccable/review/gate9-road-finish/itpo-arrival.png).
- The independent finish reviewer returned **Ship at the scoped change**, with no blocking introduced defect. An existing garden-triangle intrusion was outside this change's scope. The detector returned `[]` on the changed TypeScript before the final metadata-guard refinement.
- Color-mode runtime appearance remains unverified: the automated toggle wait failed after 90 seconds, the appearance status was blank and reported errors were `[]`; no Color-mode screenshot was captured. Palette identity was checked only in the isolated checks above. No movement tests were run, and this static review does not certify navigation or runtime performance.

The README already records this continuation. No global design-system documentation was changed.
