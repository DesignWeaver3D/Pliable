# perf-core notes (agent/perf-core)

Enclosure = the owner's 114-solid STEP as imported (120 bodies with the 6 surface bodies, 8219 faces). Script: `C:\dev\pliable-wt\perf\replay.py full`.

## Task 1: independent bodies on import

Finding: the bodies do NOT share sub-shapes at this commit. Since the surface-body import (b6eef8c) the 6 open shells are bodies, so
`body_ranges` is not None on the import as is (sum of own extents == model counts: 8219 / 21693 / 14155), and no copying is needed
(cost 0 s, not built). The real reason the per-body speed paths never applied: `mergememo.py` and `facemerge._unified_in_parts` counted
only solids (`_solid_list`, 114) while the operation's body positions count solids and shells (120), so the merge memory was never
kept and the scoped merge never matched. Fixed by numbering bodies with `solids_of` there, and by translating body positions to solid
positions for `merge_same_surface` (it numbers solids only; before, any surface body before a solid shifted the numbering).

Tools that create bodies: not checked individually; nothing copies sub-shapes, and `body_ranges` is the guard (falls back to whole model).

Timings (replay.py full, owner sequence, s), before -> after:
- preview dx=5 (first drag preview): 14.7 -> 14.9 (first whole-model merge; task 3)
- preview dx=10, dx=15: 14.8, 14.6 -> 0.49, 0.49
- commit dx=15: 16.4 -> 3.3
- preview dx=5 after the commit: 5.9 -> 4.8; commit again: 4.9 -> 1.6
- arm (zero move preview): 4.0 -> 4.0 (full display of 120 bodies, unchanged)
