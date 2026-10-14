# Bharat Mandapam visitor mode

Mode: Experience. A local extension of the existing venue viewer, not a redesign.

THESIS: Walk through the existing campus and its available interiors as one visible visitor.

OWN-WORLD: Inherit the venue's pale warm panels, charcoal green text, brown focus accent, Arial UI, squared controls and dominant architectural scene. The planner's blue control palette does not apply to this surface.

STORY: Normal overview → Visit as a Person → Gate 6 arrival → campus paths → signed doorway → furnished hall → walk back outside or Exit visit. Existing hall walkthroughs stay available in overview mode.

FIRST VIEWPORT: The normal overview retains its scene and gains a clear Visit as a Person button. Entering the mode shows the supplied Nathan character outside the photographed Gate 6, a following camera, concise wayfinding, movement controls and a persistent exit.

FORM: Code-led, precisely specified local extension. No concept roll or comp applies. Existing 3D scene and controls are the visual authority. Use the supplied Nathan model as the playable character, geometry-derived entrance frames, automatic sliding doors and a following camera. The original procedural character remains a loading/failure fallback; Nathan retains his textures and captured walk animation.

Scope: Hall 1–5, Hall 14 and the three existing Convention Centre floors reuse current furnished interiors. Other buildings remain exterior-only. Entrance routes, furnishing and the CC approach are illustrative, visibly disclosed; no claim of surveyed accuracy. No backend or saved-layout changes.

Checks: Gate-to-entrance reachability on the shipped mesh, collision substeps, door crossings in both directions, floor changes, restored overview camera, input cancellation and disposal; real browser desktop, phone, existing walkthrough and rendered entry checks. Review captures are stored under `.impeccable/review` and are not committed.

## Implemented surface rules

**Scene first.** The supplied Nathan avatar and third-person following camera operate outdoors and in the existing furnished interiors. The original procedural avatar appears only while loading or after a load failure. Stationary guards remain unchanged. Controls sit at the scene edges: launch above the overview, navigation at upper left, movement at lower left and Exit visit at upper right. Camera obstruction handling includes the interior mesh layer.

**Venue continuity.** Panels and movement buttons use warm pale `#f3f0ea`, with charcoal green text (`#29352f`, `#304036`), subdued green option fills (`#e1e5de`) and dark pressed states (`#353c36`, white text). Focus uses the existing brown accent (`#9a623f`). Squared controls and soft panel shadows preserve the venue's established overlays. These are local venue rules; root `DESIGN.md` and `.impeccable/design.json` continue to describe the planner.

**Compact hierarchy.** Inherited Arial/Helvetica UI uses a 16px, weight-600 location heading, 12px panel copy with 1.5 line height, 11px labels and a 10px illustrative-scope note. The mobile location heading is 14px. Direction and distance sit beside the entrance selector; distances use tabular numerals.

**Responsive controls.** Desktop navigation is 310px wide with 18px padding. At widths up to 700px it sits 12px from the left, uses `calc(100% - 24px)` width capped at 340px (300px for CC floors), and has 12px × 14px padding. The movement pad keeps 48px square buttons and 5px gaps; ordinary action buttons are at least 44px high, the selector 42px, and mobile Exit visit 40px. Short desktop viewports (up to 600px high) compact the panel to 285px and move the pad to the right.

## Built interactions and accessibility

- W/A/S/D walks, arrow keys turn, dragging looks, and Shift or Walk faster increases pace. Phone direction buttons support holding; pointer cancellation and lost capture release movement. Restart at gate returns to Gate 6.
- Find an entrance supplies bearing and metres without teleportation. Sliding doors open on approach and permit entry and exit. CC Level 1–3 buttons switch furnished floors; Level 1 provides the outdoor return. Exit visit or Escape restores the overview and its existing walkthroughs.
- The selector has a visible label; navigation, movement and floor groups have accessible names. Movement buttons have individual labels, active speed/floor buttons expose `aria-pressed`, and hints use `role="status"`. Decorative SVGs and the transition veil are hidden from assistive technology. Focus rings are 2px with a 3px offset.
- Scene transitions use a 250ms opacity fade; `prefers-reduced-motion: reduce` removes that CSS transition. This is a transition-specific accommodation, not a claim that all scene animation is disabled.
- The panel visibly states “Illustrative entrances and interior layouts.” Entrance routes, furnishings and the CC podium approach remain illustrative; other buildings remain exterior-only. No surveyed-access or full-venue-interior claim is implied.

## Historical finish evidence

Recorded from the original procedural-avatar implementation and review, 2026-10-10: production build passed; all 14 visitor, venue and CC regression tests passed. After the interior camera-obstruction correction, all 7 visitor tests passed again. The reviewer accepted that scored correction with a ship verdict and observed no regressions. These results predate the supplied-avatar replacement and do not validate it.

The detector ran once: 27 advisory findings from comparing the incumbent venue palette with the planner-only design reference; zero primary findings. This records the scoped mismatch without promoting it into a global palette change.

The primary agent viewed `desktop.png`, `mobile.png`, `hall1-entrance.png`, `hall1-inside.png`, `cc-level1-entrance.png`, `cc-level1-inside.png` and `visitor-overview.png` under `.impeccable/review/`; the reviewer viewed the first six. These captures are local review evidence and are not committed. This documentation pass adds no new test or visual-review claim.

## Historical venue entry and jump extension

Recorded 2026-10-11, before the supplied-avatar replacement. **Enter Venue** appears near the nearest accessible hall or CC entrance, independently of the dropdown selection. Entry follows a collision-checked route through the real doorway; existing walk-through behavior remains available.

**Jump** uses Space once per press or the mobile Jump button. The initial gravity-driven hop prevented midair double jumps, checked head collisions, and kept ground-route walls and guards solid. Keyboard controls ignore form and button targets. At that stage the original avatar model was unchanged; its pose and shadow adapted to the hop, and no raster assets were added. The current replacement retains the subsequently increased jump height and existing collider.

**Mobile entrance controls** keep Enter Venue exposed and place the selector and Go to hall behind the accessible Choose another hall disclosure, preserving avatar visibility. Desktop retains the selector.

Validation: five targeted tests passed in `test-results/entry-jump-final`, covering the actual all-hall auto-walk controller, jump/ceiling/guard collisions, entry at every fitted hall and the CC, and desktop/mobile workflows. After the mobile disclosure fix, the browser workflow passed again in `test-results/entry-jump-mobile` (21.1s). Final production build passed (11.1s), with existing planner CSS-budget and CommonJS warnings. Review accepted the single scored mobile avatar-visibility fix; desktop was preserved. The detector recorded 14 unrelated planner-palette advisories and zero primary findings in `.impeccable/review/entry-jump-detector.json`.

Desktop and mobile captures: `test-results/entry-jump-mobile/artifacts/visitor-entry-jump-visitor-4dc13--work-on-desktop-and-mobile/{desktop,mobile}.png`.

## Historical Tripo avatar

Recorded 2026-10-11. The playable avatar derives from the supplied `tripo_rigging_1ddb4b57-7e2f-4059-accc-a0e578202ee8_meshopt.glb`. `scripts/prepare-visitor-avatar.mjs` prepares `src/assets/venue/characters/visitor.glb`: 59,998 triangles, 36,469 vertices and 2,676,636 bytes, reduced from approximately 1.4 million triangles and 9.1 MB while retaining the texture and skinning. The model has 39 bones and no animation clips. Runtime normalization sets its height to 1.8 m and forward direction to +Z; walk and jump motion use procedural skeletal poses and foot probes, not authored clips.

`src/app/home/visitor-avatar.ts` owns loading and lifecycle, `visitor-avatar-rig.ts` adapts the rig, `visitor-avatar-skin.ts` repairs skin ownership, and `visitor-avatar-seams.ts` separates fused inner-thigh geometry. `visitor-avatar-fallback.ts` preserves the original procedural visitor for loading/failure states. Loading begins on first Character Mode entry, supports abort and disposal, and retries a failed load after exit and re-entry. The existing collider and higher jump remain in place; stationary guards and the venue's Experience identity are unchanged.

Initial replacement validation: TypeScript passed and the production build exited successfully in 61.1s with only existing planner CSS-budget and CommonJS warnings. No test cases were run, as instructed by the user. The avatar-module detector returned `[]`. Review of `.impeccable/review/avatar-desktop.png` and `.impeccable/review/avatar-mobile.png` received a Ship disposition scoped to static appearance. Those captures do not validate animation quality, movement or collisions; the historical test results above do not cover this replacement.

### Crossed-leg correction

Recorded 2026-10-12. The supplied mesh mixed opposite-thigh skin weights and physically joined the inner thighs. The runtime repair assigns skin ownership through mesh geodesic spread with pelvis anchoring at the waist, widens hip spacing and straightens the legs, then separates the fused inner-thigh geometry in the neutral pose and reprojects it into bind space. This is a narrow avatar repair within the existing venue identity.

Independent review gave a Ship disposition for `.impeccable/review/avatar-leg-fix-v3-front.png` and `.impeccable/review/avatar-leg-fix-v3-mobile.png`: the static frontal captures show a continuous gap below the crotch, no X-shaped bridge, and no blocking visible holes, torn waist or unacceptable deformation at the shown scale. This resolves the requested crossed-leg appearance in those views; movement, side and rear views were not verified.

Validation: `tsc --noEmit` and `npm run build` passed, with existing CSS-budget and CommonJS warnings. No tests were run, as instructed by the user.

## Historical Meshy avatar

Recorded 2026-10-12. The user replaced the Tripo avatar with `Meshy_AI_Woman_walking_1012063350_texture-compressed.glb`, copied unchanged to `src/assets/venue/characters/visitor-woman.glb` (1,365,796 bytes). This Draco-compressed mesh has embedded textures, 539,038 triangles, no skin/skeleton and no animation clips. `visitor-avatar-model.ts` preserves its supplied pose, normalizes height to 1.8 m and places its lowest point on the ground. The old Tripo skin, seam and pose corrections are not applied. Navigation, turning and jumping still move the avatar through the existing controller; there is no articulated walking animation in this source asset.

`visitor-avatar.ts` uses a locally hosted Draco WASM decoder, limited to one worker and disposed after parsing. Loading/failure fallback and resource cleanup remain in place. No test cases or browser verification were run for this replacement, at the user's request; historical validation above does not cover this model.

## Current Nathan avatar

Recorded 2026-10-14. The user requested replacing the existing avatar after supplying Renderpeople Nathan's animated walking FBX. `scripts/prepare-nathan-avatar.py` prepares `visitor-nathan.glb` (1,916,228 bytes) with its 88-bone skeleton, captured walk, and embedded 2K diffuse/normal textures. Existing controls and venue appearance remain the visual authority.

The runtime normalizes standing height to 1.8 m, derives a neutral standing pose from the walk cycle, blends between standing and walking, and suppresses root displacement so navigation owns the position. Cadence follows movement speed with a cap for fast travel. Reduced motion and airborne states blend to standing; jumping remains owned by the existing controller. Loading/failure fallback, retry, contact shadow and disposal remain supported. No new network dependency or runtime decoder is required.

The source contains no authored idle, run or jump clip. Its averaged standing pose is an application adaptation. Renderpeople licensing applies; this local integration does not establish public deployment rights. Asset provenance is recorded beside the GLB.

Validation: TypeScript and production build passed (existing planner CSS-budget/CommonJS warnings). Both targeted `e2e/visitor-avatar.spec.ts` checks passed: ten seconds of root-drift/grounding/pose/cleanup checks against the shipped GLB, plus real Chrome desktop/mobile loading, walking, jumping and exit. The primary agent inspected the desktop, walking and phone captures in `test-results/nathan-avatar-render`. The avatar-module design detector returned no findings. Software-rendered preview timed out; the successful browser run uses the project's existing Windows hardware-rendering convention.
