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
