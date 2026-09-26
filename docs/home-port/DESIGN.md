---
name: Bharat Mandapam home port
description: Inherited visual and interaction contract for the exact-fidelity Angular home port.
colors:
  text: "#272c2b"
  scene-background: "#8b9391"
  navigation-surface: "#f3f0eaeF"
  navigation-active: "#353936"
  selection: "#9a623f"
  detail-surface: "#f1f0ec"
  gallery-surface: "#f4f3ef"
  gallery-active: "#805c43"
  focus: "#b9794c"
typography:
  body:
    fontFamily: "Arial, Helvetica, sans-serif"
  welcome:
    fontFamily: "Georgia, 'Times New Roman', serif"
    fontSize: "clamp(30px, 4.8vw, 44px)"
    fontWeight: 400
    lineHeight: 1.17
    letterSpacing: "-1.1px"
---

# Design contract: home port

## Overview

This record applies only to the home explorer. The supplied [venue-explorer.html](<C:/Users/Shivam Sharma/Downloads/outputs/outputs/venue-explorer.html>), its adjacent `.css` and `.js`, assets, and helper modules are the visual authority. Preserve their composition, density, controls, rendering, and quirks. This is a port, not a new design system for the planner.

The only intentional visible addition is **Stall planner ↗**, an Angular link to `/planner` at the upper right. The [home component](../../src/app/home/home-page.component.ts) and [template](../../src/app/home/home-page.component.html) own the explorer UI through Angular components and signals. Inherited styles now live in [home CSS](../../src/app/home/home-page.component.css), [home CSS continuation](../../src/app/home/home-page.component-2.css), [gallery CSS](../../src/app/home/venue-gallery.css), [loading CSS](../../src/app/home/venue-loading.css), and [loading CSS continuation](../../src/app/home/venue-loading-2.css). The TypeScript [scene](../../src/app/home/venue-viewer.ts) and [globe](../../src/app/home/venue-globe.ts) retain the supplied rendering values. The home component retains Angular ShadowDom encapsulation to isolate these styles from planner styles; the former `vanilla/` DOM modules are removed.

## Colors

Warm off-white panels sit above a muted gray-green scene. Dark navigation selections use white text; brown marks selected submenu entries and map tools. Gallery tabs use their separate darker brown. Keep these existing distinctions rather than consolidating them.

The welcome overlay retains its radial gradient (`#fffdf7` at 0%, `#f5f1e8` at 55%, `#ede7dc` at 100%), fine warm architectural line drawing, and two faint circular outlines. The progress track is `#ddd6c8` with a `#99825d`–`#c0a574` gradient. Stage indicators retain loading, green ready (`#5d7660`), and red-brown error (`#9d533e`) states.

## Typography

Use system fonts without new font downloads. Explorer text is compact: navigation (12px, 600), submenu and body (11px), detail headings (13px, 500), room titles (14px, 600), and secondary labels (9–10px). Body paragraphs use 1.65 line height. The identity uses 12px text with 1.8px tracking.

The welcome title uses the serif token above; its “Welcome to” line is Arial (16px/1.4). The italic footnote is Georgia (12px/1.7). Preserve the responsive overrides: title 34px at widths up to 480px, then 31px when height is at most 650px.

## Layout

The scene fills the fixed viewport. Desktop navigation is 225px wide, 10px from the left, vertically centered, with a maximum height of `100dvh - 120px`. Opening details on widths of at least 701px moves the navigation to 72px from the top. The standard detail panel starts 233px to its right and is 224px wide; room/hall galleries are 350px wide. Controls stack at the lower right; status and gesture instructions run along the bottom.

At widths up to 700px, navigation becomes 190px wide and sits 50px above the bottom. Detail panels overlay that area from the left, capped to `100vw - 64px`; gallery width is at most 350px. Map buttons grow from 33px to 38px. The city subtitle, gesture hint, and floor-plan original link hide. Preserve this overlay behavior and existing overlap rather than introducing a new mobile layout.

The welcome content is centered in a shell capped at 480px, with a 360px progress section and a 370px illustration. Existing 480px-width and 650px-height media rules compact it. The floor-plan dialog is 94vw by 92dvh, becoming 98vw by 96dvh on mobile.

## Elevation & Depth

Panels retain restrained shadows, including details (`0 4px 18px #10271e16`) and map controls (`0 1px 5px #23302718`). Scene rendering is part of the visual contract:

- Perspective camera: FOV 40, near 1, far 50,000,000. Source coordinates transform through `W(s,t,z) = (.5s + .8660254038t, z, -.8660254038s + .5t)`.
- Overview position/target: `[-720,600,640]` / `[-65,12,0]`; Convention Centre: `[-350,-20,112]` / `[-284,-228,23]`. Initial framing uses radius 510; subsequent overview framing uses 490. Keep this difference.
- Antialiasing, pixel-ratio cap 1.5, sRGB output, AgX tone mapping, exposure .86, PCF soft shadows, and a four-sample half-float render target remain unchanged.
- Evening defaults: environment intensity .32; hemisphere intensity .38; sun intensity 4.5 at `[-550,430,300]`; fill intensity .25. Sun shadows use 4096², bias −.00008, normal bias 1.1, radius 3.
- SSAO: 32 samples, radius 6; per-frame distance limits `.12 / (far-near)` and `10 / (far-near)`. Bloom strength .19, radius .65, threshold 1.15. Above distance 5500, render directly without these passes.
- Daylight changes sun to 3.8, hemisphere to 1.3, exposure to 1.05, environment to .6, and bloom to .075. Selection blends eligible materials toward `#ac7855` by .25; preserve material exclusions.

Retain the supplied architectural GLB, textures, metadata, and hidden `cc_level` objects; do not simplify or restyle them. [GLB evidence](glb-summary.json) records the inspected asset.

## Shapes

Navigation, tool surfaces, and the floor-plan dialog are square. Gallery cards use 5px corners, gallery tabs and arrows 3px, photo counters 20px, and close buttons are circular. Preserve these local values rather than normalizing every surface.

## Components

**Welcome gate.** The [loading component](../../src/app/home/venue-loading.component.ts), [template](../../src/app/home/venue-loading.component.html), and [loading state](../../src/app/home/venue-loading.state.ts) wait for venue (80%), rooms (10%), and halls (10%). Background controls remain inert until all three succeed; a prepared scene is drawn before release. Errors keep the overlay visible with retry: venue failure reloads the page, directory failures retry their failed tasks. Room/hall photos load lazily after directory readiness. The existing loading dot breathes over 1.8 seconds; reduced-motion CSS disables this animation and CSS transitions, but does not remove the inherited camera tween.

**Explorer.** Drag orbits, right-drag pans, and scroll zooms. Orbit damping is .085, rotation .6, pan .7, zoom .9, minimum distance 32, and maximum polar angle `.46π`. View flights take 1350ms with smoothstep interpolation; user control cancels a flight. Tool zoom factors are .74 and 1.35. Selection clicks allow at most 5px pointer travel. Menu groups, collapse, home return, globe transition, daylight, and Escape-to-close behavior remain inherited.

**Details and galleries.** The Angular [details component](../../src/app/home/venue-details.component.ts) opens [room galleries](../../src/app/home/room-browser.component.ts) for Convention Centre levels and [hall/floor galleries](../../src/app/home/hall-browser.component.ts) for hall selections. Preserve current level-selection behavior without adding a new cutaway. The shared [photo gallery](../../src/app/home/photo-gallery.component.ts) cycles with arrows, keyboard arrows, and horizontal swipes over 45px; photos keep loading/unavailable placeholders. Room images use 16:9, hall images 3:2. The overview hides the Convention Centre floor-plan button as the source does. The [home-scoped data service](../../src/app/home/venue-data.service.ts) retains the existing ITPO directory sources.

**Floor plans.** The Angular [floor-plan dialog](../../src/app/home/floor-plan-dialog.component.ts) and [template](../../src/app/home/floor-plan-dialog.component.html) retain the existing modal, original-image link, Fit control, and multiplicative zoom (1.4, bounded 1–5). Fit calculation subtracts 40px on both axes even when mobile padding is smaller. Do not correct that inherited quirk as part of the port.

**Planner link.** The added link uses the inherited navigation surface and Arial 600; desktop top/right offsets are 18px/14px, padding 10px 12px. Mobile uses 10px offsets and 9px padding. Its destination is separate from home data readiness. [Angular-native verification](angular-native/verification.json) reached `/planner` and returned home, but the local backend at `localhost:8080` refused connections for halls, layouts, and stall types. Planner persistence/backend workflows were therefore not verified; the home directories use the existing ITPO APIs.

## Do's and Don'ts

- Do compare the inherited states using the current [pixel comparison evidence](angular-native/pixel-comparison.json), [interaction evidence](angular-native/verification.json), and paired screenshots: [loading](angular-native/compare-loading.png), [full view](angular-native/compare-full.png), [Convention Centre](angular-native/compare-closeup-cc.png), [hall](angular-native/compare-closeup-hall.png), and [mobile](angular-native/compare-mobile.png). Loading, full view, and mobile had zero measured pixel differences in the captured comparisons; closeups had small differences. The planner-link rectangle was excluded except in loading. Finish review disposition: ship; no material visual mismatches in these captured states.
- Do preserve source assets, labels, scene constants, loading dependencies, responsive rules, and quirks. Keep the supplied GLB and raster assets byte-identical. [Angular-native performance evidence](angular-native/performance.json) and [source inventory](source-inventory.json) are separate records, not permission to alter quality.
- Don't substitute a redesign, normalize spacing/colors, add cutaways, enlarge all controls, or invent a reduced-motion camera behavior during this port.
- Don't treat the local planner backend failure as a home visual defect or claim it was validated end to end.
