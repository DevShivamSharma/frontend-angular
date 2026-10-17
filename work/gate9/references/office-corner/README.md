# Office corner correction — 2026-10-17

The sequential user crops locate the cream canopy on the office frontage, a low
concrete wall with two red fire cabinets at its corner, and a clear concrete lane
between the canopy and the right-hand black fence. The next frame looks down the
open long office-side lane. The sideways reference is retained in its original
orientation; it supplies the reverse-turn context.

`scripts/gate9-office-corner.py` clears the previously inferred dense trees from
the marked turn, adds the frontage canopy and wall/cabinets, continues the right
fence, and joins the concrete circulation to the existing lane. Office footprint,
halls, avatar and controls remain unchanged. No invented cabinet lettering.

The canopy footprint, roof profile, spacing, road widths and camera poses are
editable estimates. See `gate9-office-corner` and `gate9-office-lane` in the app.
No test cases or browser verification. One offline placement render only.

The offline model.png exposed obsolete diagonal kerbs and an old shelter tail crossing the new turn. Those were removed in the final export, and the right-hand fence was extended toward the camera. The saved image precedes this final cleanup; no repeated render was run.
