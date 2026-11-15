# perf-core agent notes

## Task 1: changed bodies passed to the merge
Measured on the 120-body enclosure (script `C:\dev\pliable-wt\perf\pcore_chain3.py`, merge time inside `merge_faces`):
- Default mode ("this"): push/pull, hole and fillet are already narrowed to the owning body (`body_scope.narrow`), so the merge sees 1 body: 0.00-0.02 s; each op about 0.8-1.2 s in total (reply encoding, topology, display), unchanged by this work. The first op right after an import takes 12 s only because it competes with the background import merge (8.2 s, 121 merges).
- "others" mode (`interact: others`): add_hole merged all 120 bodies, 9.3 s (push/pull merges only the bodies it touches already).
- Scale body and Offset body (not narrowed) merged the whole model too.
Change: `mergescope.finish_scoped` (changed bodies found by identity against the start model; scoped merge only when the start model is known merged; otherwise the whole merge, flagging `result.merged` when it settled). Used by add_hole (and subclasses), scale_body, offset_body. `narrow` gives the inner scene the scene's `merged` flag; `widen` only keeps `result.merged` when the scene was merged. Not changed: tools with tracked faces (push/pull: `_unified_in_parts` refuses tracked items), fillet (always narrowed), mirror/arrays/body boolean (body count changes).
Guard tests: tests/test_merge_scope_tools.py compare scoped and whole results.
Before/after on the enclosure in "others" mode (4 holes in a row): identical to baseline (whole merge of 120/121/232 bodies, 3-20 s each) because each hole there changes the body count (holes split thin bodies), so neither the identity diff nor the settle test applies. In default mode nothing changed (already narrowed, merge 0.00-0.02 s). The saving exists for a merged model where the body count is stable (scale, offset, hole); proven equal to the whole-model result by the guard tests, not measured as a speed-up on the enclosure.

## Task 2: mixed box selection
`measure()` returns an empty reply (no items, summary or dimensions) when a selection has more than one kind of item; the app's measure panel hides itself on an empty reply and the page no longer logs a failure. Tests in core/tests/test_measure.py.
