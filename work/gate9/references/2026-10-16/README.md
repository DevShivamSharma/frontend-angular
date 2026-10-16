# Gate 9 narrated walkthrough — 16 October 2026

The original user-supplied MP4 is preserved at its Downloads path. `source.json`
records its SHA-256, dimensions and duration. No media was uploaded to a transcription
service. These reference images are extracted from that video, not generated images.

The video is 145.112 seconds long, 478 × 850 pixels, with audio. Frames were sampled
every three seconds. Contact-sheet labels are approximate (allow about 1.5 seconds).
The phone rotates during the second half; the four `upright-*.png` references are
rotated 90 degrees counter-clockwise without changing their content. The numbered
contact sheets retain the original orientation.

## Observed sequence

| Approximate interval | Visible evidence | Revision |
| --- | --- | --- |
| 00:00–00:12 | Inside entrance, elevated red lookout with external metal stair and glazed cabin | Added external steps, landing, handrails, supports and side glazing outside the vehicle opening |
| 00:12–00:24 | Turn towards fence/parking and back towards the checkpoint | Existing checkpoint, gates, barriers and parking retained |
| 00:24–01:00 | Broad cream shelter, low wall, planting, paired red fire cabinets | Registered the cabinets at the shelter end wall; retained roof and fence |
| 01:03–01:21 | Office on the right; open vehicle lane; hedge/garden on the left; arched pedestrian shelter ahead-left | Moved only the separately authored walkway and ENTRY pavilion to the garden side; restored an open office-side frontage |
| 01:24–01:36 | Camera turns towards cream ENTRY pavilion, low wall, white framing and planted margins | Added a short wall return and maintained an open entrance; retained existing transcribed sign artwork |
| 01:45–02:03 | Office forecourt/drop-off, tan paving, pots, rounded planted edges, slender garden trees across the lane | Rounded the existing plumeria island; added sidewalk paving joints/pots and a low landscaped garden |
| 02:06–02:24 | Curving lane, low yellow/black kerb, planted corner, perforated utility-cover band and drain | Lowered local kerbs and added flush cover panels, grilles and layered garden trees |

## Registration and uncertainty

The direction and relative placement are supported by the walkthrough. Absolute
campus coordinates, dimensions, widths, stair rise, kerb height, plant species and
spacing remain estimates. The office footprint, halls, hangars, external road tie-in,
playable avatar and application controls are unchanged. New camera poses approximate
the sequence; they are not calibrated photogrammetry or reconstructed phone poses.

The long walkway is now on the garden side of the office lane. Its exact length and
the pavilion's absolute position need a marked aerial route or measured site plan.
Unseen paths, interiors and small illegible sign text have not been invented.
The existing global asphalt-road preference remains active in the application even
though the reference video shows concrete on this inside lane; the Blender source
retains its authored concrete material. This revision does not override that prior
road-finish choice.

Audio is present, but the local multilingual speech model produced unreliable text.
A stronger local model download failed because the host could not resolve the model
server. No transcript was accepted as factual layout evidence or as new user
instructions. The raw audio remains available in the original MP4. Any dimensions
or directions supplied only in narration still need confirmation.

Useful additional evidence: a marked aerial showing this walking route and camera
turns; one measured lane width and canopy span; a clear still of small sign lettering.
No claim of exact/99% reconstruction is made.

## Authoring and integration

`scripts/build-gate9.py` is the reproducible authoring source. It saves editable
objects in `work/gate9/gate9-reconstruction.blend`, then batches static export meshes
by collection/material and produces `src/assets/venue/gate9-detail.glb` and its JSON
registration. Collection `12 Walkthrough details (2026-10-16)` owns the new detail.
Moving gate leaves and boom arms retain their existing separate runtime objects.
Flush road details use the existing ground naming convention; leaf geometry retains
the existing foliage convention used by collision filtering. Runtime movement has
not been exercised in this revision.

Approximate reference views:

- `?view=gate9-video-office` — office lane, around 01:18.
- `?view=gate9-video-entry` — ENTRY pavilion, around 01:30.
- `?view=gate9-video-turn` — garden-detail inspection at local (-365, -383, 1.65)
  towards (-388, -403, 2.0), not a calibrated match to the 02:12 phone pose.
- `?view=gate9-video-lookout` — close-up of the external lookout stairs.
- `?view=gate9-walkway` — corrected garden-side pedestrian shelter.

Work is isolated on `codex/gate9-video-reference`, based on main `a230875`.
The corrected pavilion has a kerb opening and a modeled 3.8 m flush connector;
runtime traversal is unverified. Garden trees reuse sparse shared leaf layers.
Only offline Blender Workbench images were inspected. Browser access was declined;
no browser or headless substitute was used.
It is not merged into the user's existing checkout. No test cases are to be run.
Build/visual evidence and its limitations are recorded separately in
`verification-video-2026-10-16.md` in the parent Gate 9 work directory.
