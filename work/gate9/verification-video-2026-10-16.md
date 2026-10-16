# Walkthrough revision verification — 16 October 2026

Scope: Gate 9 detail assets and reference documentation on
`codex/gate9-video-reference`, based on main `a230875`. No test cases run.

## Completed asset evidence

- Final `npm run build` completed successfully after the corrected export. Existing
  planner CSS-budget and `polygon-clipping` CommonJS warnings remain. No test runner
  was invoked.
- Blender 5.2.2 authored and saved the editable scene, then exported the final
  Meshopt-compressed GLB successfully: **16,637,496 bytes**.
- The export reports `sourceUnchanged: true`. Original architectural GLB SHA-256:
  `e998ea8716b8ff7a233f49aed65992bdf9d071e93697948badbef09df15e02ac`.
- Static diff review is scoped to the Gate 9 builder, generated assets and notes.
  No hall/hangar source, avatar, application controls or runtime TS was edited.
- The separate Angular development server on 127.0.0.1:4206 rebuilt successfully
  after the final asset export and sent a reload. This is server-log evidence,
  not evidence of browser rendering or visitor navigation.

## Offline visual review

Before/after and final Blender Workbench images are in `verification-2026-10-16/`.
They inspect authored geometry, not application screenshots. Workbench does not
render alpha sign artwork as the application does; white sign faces are not missing
textures. Locked reference ground can overlap the authored layer in this source
preview; the runtime has separate trimming logic, which was not exercised here.

The fresh reviewer initially required an open pavilion approach and a view that
actually framed the new garden. The single correction batch added the kerb opening
and a modeled 3.8 m connector, retargeted the garden camera, and reduced shared leaf
mesh density. The final bounded verdict was **SHIP at offline asset scope after
successful final export**:

- Pavilion approach resolved: visible kerb gap and clear paved connection.
- Garden evidence framing resolved: layered trees, utility covers and drain visible.
- Lookout detail evidenced: stairs, landing, rails, supports and glazing visible.
- Office-side lane improvement retained.

The garden camera is a detail view, not a calibrated reproduction of the phone's
02:12 pose. No HTML/CSS detector was run: this revision changes Python/Blender/GLB
assets and documentation, not HTML/CSS UI.

## Limits

Browser access was explicitly declined. No browser, HTTP page inspection, headless
substitute, automated navigation or test cases were used. Application appearance,
mobile layout, collision behavior, auto-walk, day/night appearance and performance
remain unverified. Local audio recognition was unreliable and the stronger model
download failed; no transcript was treated as confirmed layout instructions.
Dimensions, vegetation and absolute campus registration remain estimates. No claim
of photographic, 99%, or survey accuracy is made.

Prior verification documents describe older revisions only.
