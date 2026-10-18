# Agent notes: shell (branch agent/shell)

Sessions: S39, S40, S13. Not edited: docs/progress.md, docs/questions.md.

## S39 usage tracking: Done (pending merge)
- Core `usage.py` (in-memory counts), requests `usage_event` / `usage_clear`, `usage` in the diagnostics report; frontend `app/src/usage.ts`, hooks in `main.ts`, `toolpanel.ts`, `alpha.ts` (report section, Clear usage counts button, launch notice paragraph). Docs: known-limitations, protocol, watchlist.
- Decisions: counts kept in core memory, not on disk (simple, nothing persists); a "drag" surface was added beside strip/search/drawer/keys because direct drags are a start path; sketch tools not counted (outside this session).
- To remove: see the header of `usage.py`.

## S40 keyboard policy: Done (pending owner review)
- Built: `app/src/keys.ts` (pure policy: chords, command registry, validation, keymap load/save rules, `decideKey`, `Engagement`), `app/src/keyrouter.ts` (single keydown entry, focus ring on `#viewport.engaged`, blur/hidden cancels drag and typed entry via new `Viewport.cancelDrag`, Keys settings dialog with change/reset/restore defaults and a single-key off switch, saved in localStorage `pliable.keymap`), 19 tests in `app/tests/keys.test.mjs` (`npm test` in app, Node 24 type stripping). main.ts: old view/H/undo listeners replaced by the router; palette hints come from the keymap. Browser-checked: view key with pointer over view, hint when not engaged, Keys dialog.
- Decisions (change if owner disagrees): (1) Owner rule used: bare keys allowed for view, display, arm and selection; classes `model`/`setting` must have Ctrl or Alt (enforced for user assignments). (2) Kept the research default of requiring pointer engagement for bare keys (1.5 s grace) and the single-key off switch. (3) No two-key sequences. (4) Undo/redo are blocked while a drag or typed entry is live. (5) Reserved: browser keys, Escape/Enter/Tab/Backspace/Delete/Space, Ctrl+Alt. (6) Touched `viewport.ts` minimally (added `cancelDrag`) and left sketch.ts key handling alone.
- Open: should sketch keys move under the router (sketch agent's file)? Undo during a live preview was previously allowed. K4 (unsaved-work warning) and K5 (touch parity audit), K7 browser-key audit not done.

## S13 dimension leaders: Done, awaiting owner (checkpoint)
- Most of S13 was already built (see progress.md S13 log). This run added overlap avoidance (first dimension kept, later ones whose text would overlap are dropped, panel still has them) and verified by eye in Chrome: line edge (length 64 outside the part), vertex (coordinate tag), two edges (distance 50 between them). Not built: promoting a panel row to the on-model leader (decision: skipped, the plan called it optional). Fillet leader looks short when its axis points at the camera (known).
- Owner to check: label placement on a few more models, and whether dropping overlapping labels is wanted.

## Where to resume
All three sessions are done on this branch; nothing is half-done. Remaining ideas: sketch keys under the key router, unsaved-work warning, usage counts for sketch tools.

# Wave 2a

## S37 per-edge fillet form: Done
- Core: new param kind `per_edge` (`Param`, `_bind_pairs` in tools.py: a list of [start, end] pairs or bare numbers, one per selected edge in selection order) and tool `fillet_per_edge` (features.py): end 0 or equal to start is constant, start 0 leaves the edge sharp. Test in test_features.py.
- Frontend: `toolpanel.ts` renders one row per selected edge (`ParamValue` type, host `selectedEdges`), tool listed in the Edges group of layout.ts. Checked in Chrome on the bracket top face edges (rows and preview).
- Decision: a new tool instead of changing Variable fillet, so the existing one keeps its simple two-number form. If the owner wants one tool, fold the old one into this one.

## S40 leftovers and S39 sketch counts (wave 2a): Done
- Sketch keys under the router: `sketch.undo` (Ctrl+Z), `sketch.cancel` (Escape), `sketch.finish` (Enter), `sketch.delete` (Delete, Backspace). They are `fixed` (not rebindable, hidden Change button) and call the sketch's existing `onKey`, so sketch.ts changed by 3 small edits (listener line removed, `onKey` made public, usage hooks). Contexts: commands may share a key if one is `onlyInSketch` and the other `notInSketch` (Ctrl+Z). Decisions (change if the owner disagrees): Escape works without viewport engagement (cancel is harmless); Enter and Delete need it; editing keys ignore the single-key switch. Rebinding sketch keys is not offered.
- Unsaved-work warning: `beforeunload` when undo steps exist or a sketch is open. Open-over-edits confirmation not built.
- M measure: left in viewport.ts (only acts during a tool drag, which the router already excludes). Decision: not a router command.
- Touch and browser-key audits: findings recorded in the watchlist, nothing built (cheap fixes would need new buttons, a GUI-rework matter for S34).
- S39: sketch tool selections and commits counted (see watchlist).
- Open questions: should hide/isolate/see-through get visible buttons (S34)? Is the unsaved-work warning too eager since autosave exists?
- Checked in Chrome: Escape leaves a sketch with the pointer over the view. Tests: 178 core, 21 node.
## Resume
Wave 2a items are all done; nothing half-done.
