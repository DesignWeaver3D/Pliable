# perf-core agent notes

## Task 1: merge memory carry-over (04ef7a2)
- `mergememo.carry_memo` called from `handlers/tools.py` after `target.merged = result.merged`, only when the start model was marked merged before the tool ran.
- Enclosure, as imported (script `C:\dev\pliable-wt\perf\pcore_t1.py`): moves 5.1/5.3/3.6 s, push/pull commit 0.59 s, first drag preview after it 0.66 s, second 0.50 s, drag commit 0.54 s. Replies 13.9 MB (12.9 MB preview).

## Task 2 (743e3e7), task 3 (c89c0f6 and follow-up)
- `BodyData.rev`, `body_parts`, `Mesh.parts`; `meshdelta.py` (FRESH request types give base-null deltas that prime the page; a model with no bodies or no block ids gives a whole frame and resets `sent`). `full_mesh` request: plain whole frame, `resync: true` gives a base-null delta. hello `deltaMesh: true` opts in.
- Wire: header `delta: {version, base, bodies: [{id, rev, faces, edges, vertices, info, data?}]}`; `data` has `positions/normals/indices/edgePositions: [start, length]` in elements of the frame's four shared buffers, plus faces/edges/vertices/centres with body-local numbers (TS `BodyPayload` after slicing; no TS type change). `bounds` in header.
- Deleting an end body changes the model size, hence the mesh deflection, so every body is rebuilt and sent (existing behavior); a middle body sends none.
- Enclosure with delta (script `C:\dev\pliable-wt\perf\pcore_delta.py`): import 13.3 MB (whole), first move 12.5 MB (118 bodies change in the first merge), second 3.4 MB, third on 0.08 MB; drag preview 0.08 MB 0.66 s, commit 0.08 MB 0.49 s, undo 0.08 MB 0.36 s, delete middle body 0.05 MB.
- test_autosave `test_a_save_waits_for_a_quiet_moment...` failed once under full-suite load, passed alone (timing).

## Resume point
Task 4 next (app wiring).
