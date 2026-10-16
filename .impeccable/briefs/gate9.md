# Gate 9 photographic reconstruction

Mode: Experience. Scope: Gate 9 approach, checkpoint, office-side lane and adjacent canopies. Preserve the venue interface, halls/hangars, avatar and existing controls.

Visual authority: the six supplied photographs in `work/gate9/references/`. The exterior arrival is photo 5, metalwork photo 2, internal office lane photo 6, reverse lane photo 1 and canopy court photo 4. Photo 3 has an AI-generated-content watermark and remains unverified. No invented signage or accuracy percentage.

Materials: red sandstone security buildings and office cladding, silver framed barred gate with twisted middle balusters, worn asphalt outside, brushed concrete inside, yellow/black kerbs and Jersey barriers, cream barrel canopies, deep green broadleaf and strappy planting. Single-arm lights, side-positioned barriers and a clear entrance corridor.

Author in editable Blender collections; export a separately owned and compressed GLB. Hide superseded gate geometry only after successful loading. Trim shared perimeter/vegetation geometry locally; retain the rest of those meshes. Fixed obstacles use the current triangle collision system. Sliding gate leaves remain separate from static batches and open on visitor approach.

Collection `08 Local context reconciliation` contains retained copies of only `SITE_northwest-office-courtyard-wing_*` and `SITE_northwest-office-link_*` from the prior inferred site layer. Clip the positive local `t` side at `-444 m`, cap the cuts and preserve the remaining 580 mesh objects. The GLB includes these retained portions alongside the new Gate 9 geometry; no halls are exported. Substitute only those two context groups after successful loading. Original sources and the rest of the context remain unchanged.

The registered office footprint stays fixed. Gate bearing, opening dimensions, canopy spacing and camera poses are estimates pending measured/photo evidence. See `work/gate9/README.md` and `reference.json`.

## Extension — 2026-10-16 (inside the gate, night, rain)

Ten new photographs and a walking video (`work/gate9/references/2026-10-15/`) set
the look inside Gate 9. The same builder (`scripts/build-gate9.py`) now adds the
khaki gates with two hinged boom barriers and the floodlight mast, the kiosk island
with its transcribed direction board, hedges, the fenced parking shelters with cars,
and the office-front drop-off (setts, plumeria island, ITPO barrier sign, ENTRY
pavilion, arched walkway). The cabin moved left of the vehicle gate because the new
gate photograph is taken from outside; see `work/gate9/README.md`.

Runtime: the gate and barriers open for the walking visitor and for a camera within
30 m (`venue-gate9.ts`); `venue-night-lights.ts` lights every diffuser material and up
to 20 real lights from the asset's `lights` list, and the home page follows New
Delhi's clock until the sun/moon button overrides it; `venue-rain.ts` adds a rain
toggle (vertex-shader streaks round the camera, wet darker/polished ground, grey
haze, an overcast bake of the day/night sky in `venue-sky.ts`). Three Gate 9 guards
come from the asset's `guards` list through `venue-security-guards.ts`.

Follow-ups the same day: the boom arms are excluded from the triangle collider
like the leaves (the raised right arm had stopped the walking visitor just inside
the gate); night lighting keeps a fixed pool of 6 spot + 3 point lights that follow
the camera, so shaders compile once; boundary walls run either side of the
entrance out to 60 m (left cream wall with railings and hedge, right fence then grey
wall) and the forecourt keeps no trees.

Verification: `tsc`, `npm run build`, and browser captures of the approach, kiosk,
drop-off, parking, walkway, night and rain views plus a visitor walk through the
gate. No test cases, no survey accuracy claim.

No test cases. Compile/build and static visual comparisons only. Final evidence covers desktop approach, gate close-up, interior lane and canopy, mobile, and the user's 676 px viewport. The finish reviewer accepted the bounded canopy-overlap correction: the cream shelter, fence and court read separately, with the office/lane intact. This verdict does not certify survey accuracy, navigation or performance. See `work/gate9/verification.md` for evidence and limits. Preserve root DESIGN.md: this is a local scene extension, not a UI redesign.
