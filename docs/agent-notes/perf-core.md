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
