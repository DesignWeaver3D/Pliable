# perf-core: many-body app path (Move/Rotate form, other forms, face click)

Replay: `C:\dev\pliable-wt\perf\pfc\form.py` (hello with deltaMesh, `hidden: []`, the form's six params, tool_preview/tool_commit through Session.handle on the enclosure, body selection). Earlier replay scripts sent no `hello deltaMesh` and no commit-after-preview chain, so their numbers did not apply.

Cause (not a different handler: the form, the gizmo drag and every tool form share `_run_tool`):
- After a commit the new model has no merge memory and `merged` False, so the next first preview merges the whole model again (3.7 s) and rebuilds the display of every body (the merge makes new faces). Within a drag the memory (set on the start model) makes later previews 0.4 s, which is why the replay looked fast.
- A rebuilt body got a new revision, so every reply resent all 118 bodies (11-12 MB) although their display data was identical.

Before (replay, enclosure, after the first move; core seconds, reply bytes): first preview after a commit 5.2 s / 11.5 MB; commit 1.4-2.4 s / 12.5 MB.
After: first preview after a commit 1.2 s / 3.0 MB (the merge of the other bodies was made in the background after the commit, 4.9 s, hidden in the user's time; 3 bodies resent: the moved one and the 2 the second merge pass still changes); commit 0.9 s / 3.3 MB; later previews 0.4 s / 0.08 MB (unchanged).
Unchanged and inherent: the first move after an import (first merge changes every body's display: 4.2 s, 11.5 MB), and the first commit after it (full display with edge directions for bodies the page holds as previews: 2.4 s, 12.5 MB).

Changes:
- `handlers/tools.py`: after a commit whose result is not known merged, ask for the background merge (`bgmerge.py`) of the new model, so its merge memory exists when the next preview comes.
- `bgmerge.py`: a body the merge left with the same face, edge and vertex counts stays as it was (its display stays cached) instead of being replaced by the merge's copy.
- `meshdelta.py`: a body whose rebuilt display equals what the page holds (arrays, face/edge/centre records, vertex positions; a preview's missing edge directions count as shown by a full display) keeps its revision and is not sent.

Audit of other tool forms (all forms and drags send tool_preview/tool_commit through `_run_tool`, `_mesh_reply` and the delta encoder, so the delta and the background merge apply to all):
- Scoped by design (the tool is run on the selected bodies only, `scope_to_bodies`): align face, bridge, center between, chamfer (both), delete face, divide face, draft, edit void, fillet chamfer, fillet per edge, hole features, inset face, patch fill, resize chamfer/fillet, round face, shell, thread hole, variable fillet, hole edit/groups.
- Skip hidden bodies, whole scene otherwise: add boss, add slot, loft, push/pull, push/pull surface, revolve, sweep, new holes.
- Scoped merge with memory (`changed_solids`, `merge_remembering`, `finish_scoped`): move/rotate, scale, offset, hole groups.
- Whole-model merge with no scoping, so a many-body model pays the whole merge each time (not changed; needs a per-tool look): mirror, arrays (linear, circular, concentric, path), primitives (box, cylinder, ...), body boolean, cut plane, unify, stretch, align holes, distribute holes, extrude edge, move edge, move hole, edit/fill/resize hole, convert to counterbore/countersink, hole to slot, helical sweep.
- Not through the tool path: sketch move (`sketch_move`), primitive edit (`_edit_primitive`, already one-body).

Face click (app): the press selects and starts the drag, the release clicks the same item, so `setSelection` ran twice and sent related, available_tools and measure twice. `client.ts` now lets an identical related/available_tools/measure question share the answer while it is unanswered (`sharedquery.ts`, node test); any request that may change the model forgets the open ones. Not combined into one request: that needs a new protocol message and changes the page's request order; the core answers one at a time (about 0.8 s related, 0.2 available_tools).

Resume point: browser check at the end (small multi-body model), then final report.
