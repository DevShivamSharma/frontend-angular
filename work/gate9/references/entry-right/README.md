# Gate 9: immediate right after entering

The user's latest photograph replaces the previous interpretation of an open
court with a distant shelter. Observed: close black vertical railings, red square
piers and low red plinth, cream vaulted shelter directly behind, trees above the
roof, planting at the edges, and a worn concrete turn meeting the approach.

`scripts/gate9-right-corner.py` replaces the earlier displaced broad shelter and
authors the enclosure in gate-local coordinates. The narrow distant walkway and
existing halls remain unchanged. Road asphalt is retained; the concrete is a
separate local court. Fence/posts use the existing solid-mesh collision pipeline;
ground and foliage keep the existing non-solid naming conventions.

The `gate9-entry-right` camera approximates the supplied viewpoint. Fence length,
height, shelter depth and camera registration are estimates, not measured survey
data. No invented signage, vehicles, rooms or checking interactions were added.

No test cases or browser checks. One offline image is used to inspect placement;
runtime appearance and navigation need the user's section review.

The model.png image records the initial placement check before the final extra foliage and camera aim adjustment. The final GLB and saved Blender scene include those follow-up changes. No repeated render pass or application test suite was run.
