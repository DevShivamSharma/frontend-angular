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
