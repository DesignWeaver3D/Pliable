# perf-core agent notes (branch agent/perf-core)

Scope: tasks A, B, C of the "Many-body speed" row. No behavior changes. Perf script: perf.py (114-body STEP).

## Baseline (before any change; medians in ms)
- import total 25043
- move small: total 24658 (tool.run 18117, tessellate 6339)
- move far: total 24681 (tool.run 18077, tessellate 6576)
- push/pull: total 4645 (tool.run 25, meshing 4246)

## Task A: move body measures only what it needs
Status: done. The whole-model center is now computed only when a body has no center of its own (no selection),
once, lazily. Test: test_moving_chosen_bodies_does_not_measure_the_whole_model.
A measured (perf.py, move small, tool.run): 18117 -> about 13000 (A alone, estimated from the A+B total below).

## Task B: same-surface merge measures only changed bodies
Status: done. merge_same_surface measures volume/area of only the solids holding a face of some merged group (before and after, same positions); whole shape if any such face is in no solid or the solid count changes. Callers of merge_same_surface: facemerge.merge_faces only (finish, unify_result, Stretch all go through it); function contract unchanged.
Owner may judge: the relative tolerance (1e-6) is now relative to the changed bodies, not the whole model: stricter when one small body of many merges (watchlist entry added). Test: test_the_volume_check_measures_only_the_bodies_that_merged.
Measured after A+B (move small): tool.run 18117 -> 8708 ms, total 24658 -> 15229; far: 18077 -> 8647, total 24681 -> 15277; push/pull unchanged (4645 -> 4734, noise). Full tests: 921 passed.

## Task C: parallel meshing
Status: skipped, nothing to change. meshing.py already calls BRepMesh_IncrementalMesh(solid, deflection, False, angle, True) (last argument is isInParallel) and sets InParallel on the many-holes group; ghost.py likewise. So parallel meshing is already on. Mesh time is small anyway: meshing.mesh is 932 ms of a 6.3 s mesh step in the move case (the rest is the per-face display loop in tessellate.py). Booleans (note only): ops.py:81, shared/solids.py:103/174, faces.py:68, roundchain.py:68 and ghost.py:28 already call SetRunParallel(True), so booleans already run parallel.

## Finding: the perf.py harness overstates move time
perf.py undoes after each run, and undo returns to the unmerged import, so every iteration redoes the same-surface merge of bodies 0 and 108 (3 face groups, the only changed bodies). In real use the first operation merges them for good. Measured by three moves in a row without undo (move one small body, after A+B): op 3073 / 2762 / 2715 ms, mesh step 3395 / 3209 / 2860 ms, total about 6.7 / 6.2 / 5.8 s (was about 24.7 s on the harness). cProfile of a steady-state move (2.0 s of Python): per-face display work in tessellate.py (Face/Edge wrapper __init__/__eq__, hash, CurveOnSurface: about 1.2 s), JSON encode 0.12 s, groups scan in samesurface 0.6-0.7 s (every operation scans all 8219 faces for same-surface pairs).

## Next best step (needs the owner's design call)
Per-body display data cache: mesh step is now about 3 s of the 5.8 s and it is per-face Python over all 114 bodies for one moved body (7033 faces re-read in move, 2014 remeshed). Caching display data per body (reuse for unmoved bodies) removes most of it. After that, sending only the changed bodies removes the 13-15 MB reply. Second: limit samesurface._groups to the changed bodies (0.7 s per operation) once the caller can say which bodies changed (contract change in merge_faces, owner call, Stretch also calls it).

## Resume point
All three tasks handled (A, B done and committed; C needs no change). Remaining: one browser check.
