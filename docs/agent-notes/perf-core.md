# perf-core notes (agent/perf-core)

Scripts (outside the repo): `C:\dev\pliable-wt\perf\replay.py [full|solids] [prof]`, `stages.py` (per-stage timers), `avail.py`.
Run from `core\` with `uv run python <script>`. cProfile hides pybind class constructors (solid classifier, props, merge
objects), so stage timers beat cProfile here.

## Requests the app sends (owner's sequence)
- Face click: `related` (face), `available_tools`, `measure` (all three at once from `selection.ts`), then `tool_handles` for the drag tool (push_pull).
- Right-click "select body": same set with a body selection: `available_tools`, `measure`, `tool_handles` (move_body has handles).
- Arm Move/Rotate: the form opens and schedules `tool_preview` move_body with zero values (reply carries the handles = the gizmo).
- Gizmo drag: each pointer move fills the form and sends `tool_preview` (one in flight, newest waits); the form is applied (`tool_commit`) later.

## Step 1 timings, enclosure (114 bodies, 8219 faces), through Session.handle
As imported (159 faces outside solids) vs scratch copy with only the solids (8060 faces): the same within noise.
So the open shells are NOT what makes the app path slow. Body list is 114 in both.

| request | as imported | solids only |
|---|---|---|
| related(face) | 3.0 s | 3.1 s |
| available_tools(face) | 0.85 s | 0.91 s |
| measure, tool_handles | < 0.05 s | < 0.05 s |
| available/measure/handles(body) | < 0.01 s | < 0.01 s |
| preview move (zero values, arming) | 4.3 s | 4.6 s |
| preview move dx (first moves) | 15-16 s | 14.4-14.8 s |
| commit move (first) | 18.6 s | 16.4 s |
| preview / commit after first commit | 7.1 / 6.6 s | 5.8 / 5.4 s |

Where the time goes (stage timers, solids only):
- related: `_symmetric_faces` computes area/center of every face (SurfaceProperties 8219x, 2.3 s).
- available_tools(face): `edit_void` offered() runs a solid classifier against all 114 solids (0.9 s).
- arming preview with zero values: nothing changes, but tessellate of the new Topology costs 4 s (caches miss).
- first move preview/commit: execute 9-10 s = `finish` -> whole-model merge, because `Topology.merged` is only set by a
  move's own `merge_settled` (never at import) and a preview never settles anything, so every preview before the first
  commit repeats the whole merge. Tessellate 5-7 s on top. After the first commit: merge 3.3 s, tessellate 1.9 s.

## Findings and changes (commits on agent/perf-core)
- Face click: `related` 3.1 -> 0.5 s (mirror search measured every face: now only bodies whose box holds the mirror point), `available_tools(face)` 0.9 -> 0.09 s (Edit cut classifier skips far bodies).
- A preview now settles the merge state (`topology.merged`) like a commit does.
- First moves of an unmerged model: every preview and the commit repeated the whole-model merge (same-surface 5 s, kernel 4 s). `mergememo.py` keeps the merge of the unmoved bodies on the model (`merge_memo`) for the next preview/commit of the same drag when bodies share nothing. Solids-only enclosure: preview 2 and later 15 -> 0.5 s, commit 16 -> 3 s (tessellation of a non-preview reply rebuilds every body). First preview unchanged (15-18 s).
- Not helped: the enclosure as imported (6 open shells outside every solid): `body_ranges` is None, so the memo, the scoped merge and the per-body display do not apply. That is for the surface-body work.
- Autosave: each commit queues a snapshot whose BREP write holds the GIL (2.5 s of 4 s on this model; 1.4 s without triangulations), so the request after a commit (the next drag) is slowed by 3-4 s. Measured with a real Autosaver (script fails_as.py). Not changed yet.
- Gizmo move that "does not succeed": not reproduced in the core (commits succeed and move the body by the asked distance). See step 2 below.
