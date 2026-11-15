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

## Task 2: autosave timing

`Autosaver.save` now keeps the newest snapshot (new states + meta) and arms a timer: write 1.5 s after the last change, at most 5 s
after the first unwritten change. `flush()` writes what waits; `mark_clean` (shutdown) flushes first; the connection handler flushes
when a tab disconnects. Snapshot objects (project_of) are still taken at request time, only the pack/write is deferred, so the
timer thread never reads the live document. Tests: tests/test_autosave.py (quiet wait, max wait, flush, shutdown, fresh document).
Not measured with the app: the write cost (about 2.5 s GIL) still happens, but once per burst of changes instead of per request.

## Task 3: background merge after import

`bgmerge.py`: after the import reply is built, a thread merges each body on its own (`finish` of a one-body compound), meshes the
merged body at the model's deflection, and sets `topology.merge_memo` once at the end (the memory `mergememo.py` builds on a first
drag). `Session.handle` calls `ImportMerge.before(kind)`: queries in `READS` do not wait, requests that replace the model cancel the
thread, every other request waits for it (never a half-made memory). No document change, no undo step. Threading finding: the kernel
holds the interpreter lock for most of the merge (a spinning thread ran at 9 % speed during a whole merge), so a query during the
merge is slowed: `related` 0.5 s -> 5.3 s when asked at once after import; unchanged (0.57 s) when asked 15 s later. Chunking per
body with a 10 ms pause limits the stall to one body.

Replay (enclosure as imported; waiting 15 s after the import, then the owner's sequence), s:
- first drag preview: 14.7 -> 3.9 (no wait: about 14.6, the request waits for the thread, then 4.8 -> same as before)
- later previews 0.49; commit 16.4 -> 3.4; arm (zero move) 4.0 (unchanged: first display of 120 bodies)
- not fixed, next candidates: after a commit the new model has no memory, so the next drag's first preview merges the whole model
  again (4.5 s, 1.6 s commit); carrying the memory over would skip a merge that may still change the model (merge is not always
  idempotent), a behavior question, not done. The 3.9 s of the first preview is display build of merged bodies (python), not merge.
