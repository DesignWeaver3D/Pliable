# perf-core notes (branch agent/perf-core)

Scope: operations tell the later whole-model checks which bodies changed (optional argument, None = whole model).
Measured on the 114-body STEP (8219 faces) with scripts in `C:\dev\pliable-wt\perf\` (`pc_base.py`; `pcc_time.py`,
`pcc_unif.py` break one operation down). Timings are wall seconds in the core, one operation.

## Step 1: breakdown of a steady-state operation

Baseline (`pc_base.py`): move in a row 3.2 s; push/pull and undo to the import state 4-5 s (import state, not this phase).

Move (third move in a row, merged model), total 3.1 s, all inside `shared.solids.finish` -> `facemerge.merge_faces`
on the whole model (move_body is not narrowed):
- `BRepBuilderAPI_Copy` of the whole topology: 0.31 s
- `ShapeUpgrade_UnifySameDomain.Build`: 0.71 s
- `is_valid` of the merged whole model: 0.99 s
- `samesurface.merge_same_surface` (`_groups` scan of all faces and edges, finds nothing): 0.65 s
- rest (tool, document push, Topology maps, mesh reply encode 0.12 s): about 0.45 s

Push/pull on a merged model: 0.54 s in all (it is narrowed to the one body, so its merge is already small). Its 4-5 s
in `pc_base.py` is the import state, which is out of scope here.

So the whole-model passes of a move are: topology copy, kernel merge, validity check, same-surface scan.

## Step 2: same-surface scan limited to changed bodies (done)

`merge_faces(result, same_surface, changed=None)` and `merge_same_surface(shape, changed=None)`: `changed` is a set of
solid positions; None keeps the whole-model behavior (Stretch and every other caller are unchanged). The promise that
the other bodies are merged already comes from `Topology.merged` (set by Move/Rotate on bodies once its merge ran on a
model known merged, or on the whole model) plus `mergescope.changed_solids`, which also requires no face, edge or vertex
shared between bodies or held outside them (same check as `bodydisplay.body_ranges`). Imported / opened / any other
state is not flagged, so its first move merges the whole model as before, then flags the result.
Measured (`pc_base.py`): third move in a row 3.16 s -> 2.62 s (commit aab0159).
Tests: `core/tests/test_merge_scope.py` (scoped equals whole-model fingerprint: counts, per-id face area and centroid, edge lengths).

## Step 3: kernel merge, topology copy and validity check limited to changed bodies (done)

`facemerge._unified_in_parts`: with `changed` and no tracked items, only the changed solids are copied, merged and
checked; they go back in their places in a flat compound of solids, the others as they are. Anything else (tracked
items, nested compound, solid count change) merges the whole model as before.
The "known merged" flag turned out too weak: one whole merge of an imported model is not a fixed point (the
same-surface step leaves edges that the next kernel merge removes; 6 edges and 6 vertices still changed on the third
move), so the flag is now set only when a whole-model merge left the face, edge and vertex counts unchanged
(`mergescope.merge_settled`). On the 114-body model that is the third move after an import; later moves are scoped.
Checked: after 4 moves, move 5 scoped vs forced whole-model gives the same reply for the page (faces, edges, vertices
with ids, bodies, meshes; only timings differ) via `perf/pcc_cmp.py`.
Measured (`pcc_base6.py`, moves in a row without undo): move 3 3.1 s (whole, not settled yet), move 4 0.81 s, moves 5-6 0.48 s
(was 3.1 s). Push/pull on a merged model was 0.54 s already (narrowed); its 4.5 s in `pc_base.py` is the import state.
Not scoped (left for the owner / not needed): the first operations after an import (whole model by design), faces
outside solids, shared sub-shapes (`changed_solids` returns None), tools other than Move/Rotate on bodies (they do not
pass `changed`; push/pull etc. already narrow to the body).
Tests: `core/tests/test_merge_scope.py` (7), full suite 936 passed.

## Resume point

Steps 1-3 done. Left: browser check on 5202/8802 (several bodies, move one, push/pull a face, undo both).
