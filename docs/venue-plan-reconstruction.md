# Supplied hall plans — reconstruction notes

The visitor avatar is unchanged, as requested after inspecting `person.bin`. That file is a binary buffer, not a complete GLB; it was neither imported nor replaced with another character.

## Sources

The four distinct ITPO standard-layout drawings are dated 29 May 2026. All have one page. The two Hall 6 PDFs are byte-identical.

| Supplied file | Drawing | SHA-256 |
| --- | --- | --- |
| `hall1.pdf` | Hall 1, first floor | `11e9524e97fd1fa9b2ab7bfeb13a37424f0592210107cb5afb1a6f0c4b95fb37` |
| `hall 2-5.pdf` | Halls 2–5, ground floor | `0ae8c6307b131cf18a9c220adbfbd3ec26c56621947795f4f3a2b924efe1d7db` |
| `hall6.pdf`, `hall-6.pdf` | Hall 6; floor designation absent | `ce758418e4867a57fcc3dd68aa5fdbe3ae384adcf385f6e1470f7dc4f58abb16` |
| `hall14.pdf` | Hall 14, ground floor | `bd8ff5d0a64f69ccc47caf3161190c61cb958d65b702761eec667dad73edc993` |

The source folder is `C:/Users/Shivam Sharma/Downloads/hall layout`. The in-app floor-plan images were refreshed from these PDFs. The original PDFs are unchanged.

## Implemented

- Halls 1–6 and 14 use traced exhibition boundaries, foyer locations, structural column rows, and service-room footprints instead of the generic stand-island/reception layout. Hall 6 now has an interior walkthrough.
- Service areas include the depicted toilet blocks, stair/lift cores, electrical/control rooms, numbered rooms, Hall 5 lounges and office, hall-master rooms and Hall 2 first aid. Small fixtures inside those rooms remain simplified.
- Open allocation outlines remain floor markings. Smoke-curtain zones have clear floor strips and overhead tracks; they are not blocking walls.
- Model columns and wall footprints generate navigation collision together. The precise polygon is used for rotated walls rather than treating a diagonal wall's whole bounding rectangle as solid.
- Public entrance preference follows the fitted foyer. Manual movement, auto-walk and guided tours use the updated obstacles; the exterior opening renderer and collision system share the selected doorway.
- Two stationary security guards stand beside every accessible portal. The supplied security model has no animations. It uses shared 24,000/4,000-triangle detail levels, shared 2048px PBR textures, instanced rendering, contact shadows and analytic body collision.
- All added labels and messages are English. Existing CC floors and their floor switching are retained.

## Accuracy and limits

The existing exterior models do not have the same dimensions as the drawings. For example, the Hall 14 drawing labels a 95 × 83 m exhibition area before its foyer and outer service spaces, whereas the incumbent roof's fitted bounding rectangle is only about 94 × 85 m. Preserving that exterior prevents a 1:1 interior reconstruction.

The implementation therefore uses a **uniform display scale** per hall, recorded in the generated group's `uniformDisplayScale`. The source calibration in `hall-plan-data.ts` remains in metres per drawing pixel; it is not overwritten by the display fit. Room footprints are manually traced from rendered drawings, not survey CAD geometry. The interior UI identifies fitted dimensions as approximate.

Hall 1's supplied drawing is explicitly a **first-floor reference**. Its layout is adapted at the existing walkthrough elevation, with that limitation shown in the UI. No verified first-floor height, ground-floor plan, stair section or lift travel was supplied, so no new physical upper-floor connection is claimed. Stair/lift volumes depict the cores only. Existing CC floor transitions remain functional.

Heights are visualization assumptions: service-room walls 3.2 m, exhibition partition walls 3.6 m, door heads 2.65 m; existing exterior/ceiling heights are retained. Public doorway gaps are kept usable after fitting. Unlabelled individual door widths, exact sanitary fixtures, stair riser schedules, structural sections and service installations are not surveyed. This is a plan-informed interactive venue model, not construction documentation.

## Verification

`e2e/venue-plan-interiors.spec.ts` checks every affected hall: solid source column positions, routing from campus, clear access from the doorway to the drawn foyer and exhibition floor, fast manual entry/exit sweeps, and travel to another hall. Its browser check renders every interior, day/night and mobile views, checks English approximation notes, and verifies visible guard instances and their detail levels.

`e2e/venue-security-navigation.spec.ts` checks guard avoidance and entrance clearance. `e2e/visitor-auto-walk.spec.ts` covers the actual visitor controller and the existing UI trip through halls and CC floor switching.

The final targeted plan, guard and navigation checks passed. The browser workflow verified Stop/manual takeover, Hall 1 arrival, travel to CC, Level 2 switching and mobile controls. The final Hall 1-to-CC trip took 50 seconds on this machine. Its test allows 90 seconds per long trip and 300 seconds overall to include asset loading; tracing is disabled to avoid GPU readback overhead.

Runtime checks on the local Intel graphics / D3D11 browser at 1440 × 1000 measured about 34 rendered FPS during orbit, zero idle draw calls and zero reduced-motion idle draw calls. This is a local measurement, not a guarantee across devices. The repeat SPA visit/exit memory test passed at a 390 × 844 viewport. No page errors were reported by those checks.

The production build has the project's existing planner CSS-budget and `polygon-clipping` CommonJS warnings; no dependencies were added.

