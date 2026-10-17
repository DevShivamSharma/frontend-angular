# Section 1 — user-corrected road and boundary

The user's two annotated screenshots supersede the earlier video-side interpretation:
the strip left of this road is the property boundary, not Gate 9 parking. The marked
canopies, pavilion and accompanying details belong on the right. Parking belongs
near CC; no new CC parking position is guessed in this section.

`scripts/gate9-section1.py`, called by the main Blender builder, removes the incorrect
parking/deck/fence and left-side planting, relocates the marked structures and their
lights, and adds the left boundary wall/railings. The editable translation is an
initial registration from the user's arrows; halls and the office footprint stay fixed.
The overview is `?view=gate9-section1`. The old parking link now shows the boundary.

The kiosk fork was a single mesh named `SITE_GROUND_gate9 kiosk fork`; the runtime
road material matcher previously recognized only collection-batched names. It now
recognizes the authored fork name too. The builder also assigns the fork the same
asphalt material as the approach, preserving consistent texture scale at runtime.

No test cases. One production build and one offline overview inspection only.
No browser access; movement and final runtime appearance are not certified.

Verification: production build passed (existing CSS budget/CommonJS warnings). Bounded offline overview review found no blocker for the side-placement/removal correction. No test cases or browser/runtime checks were run.
