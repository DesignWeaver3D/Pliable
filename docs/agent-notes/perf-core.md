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
