# Face merge agent notes (branch agent/face-merge)

Done (one commit each):
- One merge step: `core/src/pliable/facemerge.py` (`merge_faces`), called by `unify_result` (ops.py) and `finish` (shared/solids.py). Kernel merge at MERGE_ANGLE, edges only when that breaks the shape, then same-surface merge, tracked faces/edges/vertices followed. Visible change: `unify_result` tools now merge edges (not leave the plain result) when the face merge breaks the shape; `finish` unchanged except it keeps the unmerged shape if valid instead of raising when even edges-only is invalid.
- `wallframes.py` removed (all tests pass without it, same face counts). Merge time: two slabs 5 holes 7.6 -> 18.9 ms; 1 hole 4.4 -> 10.9 ms; bracket 6.6 -> 5.6 ms; 410-face plate 237 -> 240 ms.
- Limits in `core/src/pliable/mergelimits.py`; same-surface direction test now 1e-6 rad (was ~4.5e-5 via 1 - |cos| = 1e-9). Possible visible change only for models with directions 1e-6..4.5e-5 rad apart; no test changed.
- Free-form (B-spline) faces: decided out of scope, not built (see decisions-log 2026-11-14). Not built: join two B-spline faces whose surfaces coincide within MERGE_LENGTH (sample points + outward normal agreement), then the existing volume and area check per group.

Owner can judge: whether the tighter direction limit loses any merge on the owner's real models (mirror model); whether the 2.5x slower small-body merge matters.
Resume point: nothing open on this branch.
