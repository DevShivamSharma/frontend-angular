# Bharat Mandapam visitor mode

Mode: Experience. A local extension of the existing venue viewer, not a redesign.

THESIS: Walk through the existing campus and its available interiors as one visible visitor.

OWN-WORLD: Inherit the venue's pale warm panels, charcoal green text, brown focus accent, Arial UI, squared controls and dominant architectural scene. The planner's blue control palette does not apply to this surface.

STORY: Normal overview → Visit as a Person → Gate 6 arrival → campus paths → signed doorway → furnished hall → walk back outside or Exit visit. Existing hall walkthroughs stay available in overview mode.

FIRST VIEWPORT: The normal overview retains its scene and gains a clear Visit as a Person button. Entering the mode shows a full-body male visitor outside the photographed Gate 6, a camera behind him, concise wayfinding, movement controls and a persistent exit.

FORM: Code-led, precisely specified local extension. No concept roll or comp applies. Existing 3D scene and controls are the visual authority. Use an original articulated procedural character, geometry-derived entrance frames, automatic sliding doors and a following camera. No raster artwork is introduced.

Scope: Hall 1–5, Hall 14 and the three existing Convention Centre floors reuse current furnished interiors. Other buildings remain exterior-only. Entrance routes, furnishing and the CC approach are illustrative, visibly disclosed; no claim of surveyed accuracy. No backend or saved-layout changes.

Checks: Gate-to-entrance reachability on the shipped mesh, collision substeps, door crossings in both directions, floor changes, restored overview camera, input cancellation and disposal; real browser desktop, phone, existing walkthrough and rendered entry checks. Review captures are stored under `.impeccable/review` and are not committed.

## Implemented surface rules

**Scene first.** The original procedural male avatar and third-person following camera operate outdoors and in the existing furnished interiors. Controls sit at the scene edges: launch above the overview, navigation at upper left, movement at lower left and Exit visit at upper right. Camera obstruction handling includes the interior mesh layer.

**Venue continuity.** Panels and movement buttons use warm pale `#f3f0ea`, with charcoal green text (`#29352f`, `#304036`), subdued green option fills (`#e1e5de`) and dark pressed states (`#353c36`, white text). Focus uses the existing brown accent (`#9a623f`). Squared controls and soft panel shadows preserve the venue's established overlays. These are local venue rules; root `DESIGN.md` and `.impeccable/design.json` continue to describe the planner.

**Compact hierarchy.** Inherited Arial/Helvetica UI uses a 16px, weight-600 location heading, 12px panel copy with 1.5 line height, 11px labels and a 10px illustrative-scope note. The mobile location heading is 14px. Direction and distance sit beside the entrance selector; distances use tabular numerals.

**Responsive controls.** Desktop navigation is 310px wide with 18px padding. At widths up to 700px it sits 12px from the left, uses `calc(100% - 24px)` width capped at 340px (300px for CC floors), and has 12px × 14px padding. The movement pad keeps 48px square buttons and 5px gaps; ordinary action buttons are at least 44px high, the selector 42px, and mobile Exit visit 40px. Short desktop viewports (up to 600px high) compact the panel to 285px and move the pad to the right.

## Built interactions and accessibility

- W/A/S/D walks, arrow keys turn, dragging looks, and Shift or Walk faster increases pace. Phone direction buttons support holding; pointer cancellation and lost capture release movement. Restart at gate returns to Gate 6.
- Find an entrance supplies bearing and metres without teleportation. Sliding doors open on approach and permit entry and exit. CC Level 1–3 buttons switch furnished floors; Level 1 provides the outdoor return. Exit visit or Escape restores the overview and its existing walkthroughs.
- The selector has a visible label; navigation, movement and floor groups have accessible names. Movement buttons have individual labels, active speed/floor buttons expose `aria-pressed`, and hints use `role="status"`. Decorative SVGs and the transition veil are hidden from assistive technology. Focus rings are 2px with a 3px offset.
- Scene transitions use a 250ms opacity fade; `prefers-reduced-motion: reduce` removes that CSS transition. This is a transition-specific accommodation, not a claim that all scene animation is disabled.
- The panel visibly states “Illustrative entrances and interior layouts.” Entrance routes, furnishings and the CC podium approach remain illustrative; other buildings remain exterior-only. No surveyed-access or full-venue-interior claim is implied.

## Finish evidence

Recorded from the completed implementation and review, 2026-10-10: production build passed; all 14 visitor, venue and CC regression tests passed. After the interior camera-obstruction correction, all 7 visitor tests passed again. The reviewer accepted that scored correction with a ship verdict and observed no regressions.

The detector ran once: 27 advisory findings from comparing the incumbent venue palette with the planner-only design reference; zero primary findings. This records the scoped mismatch without promoting it into a global palette change.

The primary agent viewed `desktop.png`, `mobile.png`, `hall1-entrance.png`, `hall1-inside.png`, `cc-level1-entrance.png`, `cc-level1-inside.png` and `visitor-overview.png` under `.impeccable/review/`; the reviewer viewed the first six. These captures are local review evidence and are not committed. This documentation pass adds no new test or visual-review claim.
