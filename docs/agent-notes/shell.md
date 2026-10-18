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
