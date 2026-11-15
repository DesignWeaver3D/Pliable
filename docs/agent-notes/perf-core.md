# perf-core notes

Scripts (outside the repo, in C:\dev\pliable-wt\perf): `bore.py` (import the enclosure, wait for the import merge, commit a 300 mm
through bore from a face of the middle-sized body; `DUMP=file` saves ids/face counts for comparison; `prof` adds cProfile),
`bore_stages.py` (same with stage timers), `par.py`, `volpar.py` (thread experiments).

## Findings (300 mm bore on the 114-body enclosure, 120 bodies to 78)
- Today: 16.4 s. Merge 6.7 s (kernel 2.4, same-surface 4.3), volumes for body matching 2.6 s (62 volumes, 42 ms each), rest display/meshing.
- Cause of the 6.7 s: `mergememo.merge_remembering` looks the import memory up by body position. The bore removes whole bodies, so
  later bodies shift position, the memory no longer fits, and the whole model (78 bodies) is merged. Only 17 bodies changed;
  merging those alone takes 0.4 s.
- Fix tried: find each unmoved body in the memory by identity (IsSame) instead of by position (`_kept` in mergememo.py).
  Bore 16.4 s to 9.1 s (merge 0.46 s, meshing also shorter because the memory's bodies are already meshed). Patch with a guard test:
  C:\dev\pliable-wt\perf\bore_memo_by_identity.patch (not applied, not committed).
- It changes a result: after the bore two small unmoved bodies (old ids 100 and 106) keep their ids, where today they are
  given the ids 99 and 103 of the two big panels the bore cut (and ids 99/103 disappear). Reason: carry's box test uses the
  triangulation, the memory's merged bodies are meshed, the whole-model merge's are not, so today's whole merge makes those
  two fail the unchanged-body test and the overlap rule gives them the earlier id. The new ids are arguably right (unchanged body keeps its id) but differ from today.
  Everything else (face counts per body, edges 12267, vertices 8020, body order, bounds) is identical.
- Threads do not help: the kernel holds the GIL (merge of 17 bodies 0.40 s sequential, 0.42 s with 4 or 8 threads; 70 volumes 1.22 s, 1.17 s, 1.22 s).
- Volumes cannot be skipped exactly: the 1e-9 relative test needs the numbers. Only moving the work: compute them in the background
  merge (adds about 4-5 s to the wait after import) - not done.

## Resume point
Waiting for the owner's answer on the ids question (see report). If yes: apply the patch, run full tests, commit, add watchlist entry.
