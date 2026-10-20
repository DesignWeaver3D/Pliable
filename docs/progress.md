# Progress

Live status for the rebuild in [ROADMAP.md](../ROADMAP.md). Read this first in every session; commit rules are in [CONTRIBUTING.md](../CONTRIBUTING.md). Finished sessions are one line each in [history.md](history.md). Other files: [watchlist.md](watchlist.md) (shortcuts, guesses, limits), [decisions-log.md](decisions-log.md), [questions.md](questions.md) (owner questions only), [protocol.md](protocol.md) (core API), [testing-checklist.md](testing-checklist.md).

**Where things stand (2026-10-19, end of a long interactive session):** the owner tests on port 5180 and gives feedback; work since the sketch parity pass is listed under "Done, awaiting owner review" (S84). Everything is committed on `dev`, nothing pushed. One agent may still be running (S85, mesh cache, worktree `C:\dev\pliable-wt\meshcache`): check `git worktree list` and `git log dev..agent/meshcache` before starting anything.

Branches: work on `dev`; `rebuild` is the release candidate; `main` holds the MVP (`v0.2.0-mvp` tag preserves it). Last known state (2026-10-19, `dev` at the last commit): about 398 core tests and 146 node tests, typecheck and build passing (last measured on the merged branches, before the final merge of per-body see-through). Nothing has been pushed; `dev` is ahead of `origin/dev`.

## Resume note

Start here (a new session). Run the tests first (`uv run pytest` in `core/`, `npm test`, `npx tsc --noEmit` and `npm run build` in `app/`). The build queue holds only the in-flight S85 and the parked S73/S74; everything else needs the owner's hand test or answers (`docs/questions.md`: 14 and 15 are open, plus the Cut/Split question under Tools). Do not invent work; ask the owner for hand-test results or new requests. Ideas the owner or the sessions raised and nobody has built yet are in "Backlog ideas" below.
- **How the owner works with you (important):** the owner's frontend on port 5180 is served from the MAIN checkout `C:\dev\pliable` with a core on 8770. Every file edit there hot-reloads their page mid-test, so while they are testing do ALL work in a worktree (`scripts/worktree.ps1 new <name>`, add `-Base <branch>` to start from another branch) or in an agent's worktree, verify on spare ports (core 8805+, frontend 5205+, own `PLIABLE_DATA`), and merge into `dev` only when the owner says to (they usually say "merge so I can test"). After a merge: delete the agents' `docs/agent-notes/*.md`, remove the merged worktrees, and restart their core when core code changed (stop the 8770 listener and its `uv run`/`pliable-server` parents, start `uv run pliable-server --port 8770` hidden from `core/`); tell them to reload. Never stop their servers otherwise. The owner prefers agents in worktrees for parallel, separable work.
- **Run agents the cheap way:** `docs/orchestration.md` (worktrees from `scripts/worktree.ps1` run through Bash with `powershell.exe -File` because the PowerShell tool aborts the script on git's stderr; refresh before every hand-off). Old worktrees `kernel`, `selection`, `shell`, `sketch` from earlier waves are merged and can be removed.
- **Pitfalls learned this session:** (1) socket requests carry their own `id`, so request parameters must never be called `id` (kept sketches use `sketch_id`); `Session.handle` tests cannot see that. (2) Commit messages written from PowerShell get a BOM and are rejected; write them with a Bash heredoc, subject 12-72 chars, body lines of at most 80 characters for commits touching 3 or more files. (3) Long inline Python heredocs sometimes fail to parse in Bash; write the edit script to a file in the scratchpad and run it. (4) Chrome: dismiss the alpha notice and the "Got it" hint first, discard an open sketch before closing or navigating (the page warns on leave and the tab then hangs), and expect `tabs_close_mcp` to time out sometimes (stale agent tabs on ports 5206/5207 may still be open for the owner to close). (5) npm and npx only work from the PowerShell tool; `uv` works from both. (6) Node tests strip types only: no TypeScript parameter properties, and imports in files the tests load need the `.ts` extension.
- **Known limits:** body ids after an operation are matched by shape and volume (watchlist); the draft-angle dimension assumes a Z pull direction; editing a body in a model with many bodies re-extracts display data for all bodies (S85 fixes it).
- **Owner decisions in force:** first alpha release deferred (S17, no tag); sketch automatic constraints off by default; grid off by default; sketch geometry stays separate from the model (no faces added by Finish sketch); kept sketches persist; see `docs/decisions-log.md`.

## Backlog ideas (not built, raised in 2026-10-19 sessions)

- Merge Cut with plane and Split with plane into one tool with a keep option (both sides or remove one side), and let the plane come from a selected face (owner question pending).
- Sketch: dragging a point does not snap to axes or the grid yet; kept sketch curves are not selectable or snappable; closed profile faces cannot be picked or dragged with the push/pull arrow (extrude is on the sketch's row); control-point splines and shape constraints for ellipses and splines need another solver.
- Materials: a per-body material picker and a mass display (density is stored in `app/src/materials.ts`, unused); materials are one global setting now.
- Sweep along a rail and arrays along a path using kept sketch curves.
- Imperial units: lengths are millimetres through `LENGTH_UNIT` in `app/src/units.ts`; grid spacing and dimensions should follow a unit setting later.
- Per-body see-through is view-only per session; it is not saved with the document.

## Open sessions

| # | Area | Goal | Status |
|---|---|---|---|
| S17 | Alpha | Portable alpha build (PyInstaller, one launcher, CI smoke tests on four OS targets). Built and CI-verified. Deferred by the owner (2026-10-19): the first alpha release waits because the current progress is large; do not tag or publish | Deferred, owner decision |
| S30 | Sketch | Sketching reliable and fluid. Done: Finish sketch keeps the sketch as a separate object with view-only profile faces, centre rectangle with corner options, offset, round/bevel corner, projected model edges, snaps to curves/midpoints/axes/references, alignment guides, live size tags, circle/line/arc auto tangency, body drag, Alt+click zone cycling, box select of zones | Remaining: lift the alpha "unsupported" label after the owner tries sketching; kept sketches are stored now (S84) |
| S34 | UI | GUI layout rework from `docs/research/gui-plan.md`. Built: floating top-centre strip (drag tool first, as many tools as fit the width plus "N more / All tools"), browse drawer (Tools handle on the left edge of the view, T, usable-now filter; handle icon is a placeholder, constant TOOLS_HANDLE_ICON in icons.ts), slim top bar with Menu popup, permanent search field (Ctrl+K or /), gear at top right, procedural icons beside labels (contact sheet `app/icons.html` on the dev server), measurement card collapsed by default. Owner decisions still apply (dark only, owner reviews every icon, touch only while cheap) | Remaining: owner reviews the icons; search keywords, scope prefixes, recents, searchable settings, Getting started card and touch sizing are done (see history); a printable shortcut sheet and real-device touch testing are not done. Strip stays fixed top centre (following the selection is an experiment) |
| S73 | Cleanup | Shared newest-wins preview scheduler (`app/src/latestwins.ts`, unit tested). Done: the hole centre drag uses it (not hand-checked in the app). Parked: the push/pull drag (`pump`) and form previews (`drainPreviews`) keep their own copies because they carry extra state (last good size, failure flags, sequence checks); moving them is a risk with no user-visible gain | Parked |
| S74 | Sketch | Profile faces cannot be picked or dragged with the push/pull arrow yet (extrude is on the sketch's row); sketch curves are not selectable or snappable. Sketch parity items parked, needs owner direction or a different solver: shape constraints for ellipses and splines (a different solver is needed; the only candidate wheel has no macOS build), control-point splines with weights, hyperbola and parabola arcs, live (non-snapshot) projected edges (question 10), offset or angled sketch planes from a face, plane tangent to a surface (normal to an edge is done); kept sketches are built (S83, awaiting the owner's hand test) but not yet usable as sweep rails or array paths | Parked |
| S85 | Core speed | Editing one body in a model with many bodies re-extracts display data for every body (measured 2.7 s per commit at 150 bodies, boolean 15 ms). An agent is adding a per-face/edge display cache and a benchmark (`core/scripts/bench_bodies.py`); worktree `C:\dev\pliable-wt\meshcache`, branch `agent/meshcache` | In progress (agent running at the time of writing; check the branch) |


## Done, awaiting owner review

S84 (2026-10-19, owner feedback rounds; merged into `dev`, hand test needed; agents checked parts in Chrome): sketch interaction (plain click adds to selection, any curve drags whole, window and crossing box select limited to sketch geometry, Escape/Discard/new sketch confirm before losing drawn geometry, projection freeze fixed and tilted circles/arcs projected as ellipses/splines), sketch strip with drawing tools in the top bar, sketch card icons (view, grid, snap to grid) and a settings window (grid spacing in mm, grid fade, automatic constraints), shader grid with edge fade, axes over the grid, origin at face centre, Polygon tool with a chosen number of sides, sketch placement from a selected edge or three vertices, kept sketches (separate from the model, profile faces as tinted view-only faces, Extrude on the list row), holes (depth handles at both ends, no jiggle on move, dimensions follow the hole), tool availability with nothing selected and the 'Add countersink to hole' rename, Move/Rotate as one tool with rotation rings, push/pull arrow above the face and cut through all, semi-gloss plastic look with a Material setting (14 materials, densities stored), random muted body colours (names coloured too), nav cube with zoom fit all and fit selected, taller bodies list and measurement card bottom right, per-body See-through and Focus (see-through others) buttons, settings button and gear fixes. Not hand-checked: see the individual watchlist entries; notably snapping to a ghosted body's edge, Normal-to-edge sketch plane, rotation rings typed degrees, the Material choices other than ABS, gloss with a 100k-triangle model.

S83 kept sketches and sketch placement (2026-10-19, hand test needed): sketches persist in the document and stay separate from the model (no faces are added; closed regions show as tinted view-only profile faces; list under the bodies with edit, rename, delete, extrude, undo and autosave; open paths kept as curves for future sweep and path-array tools); sketch origin at the middle of the face with the sketch's own axes; drawing tools in the top strip; card icons for view, grid, snap to grid and a settings window (grid spacing in mm, automatic constraints, off by default); Sketch On Geometry with through 3 points, edge and point, and normal to an edge; push/pull arrow above the face and hidden during a sketch; typed negative kept; push/pull cut through all (preview fix). Checked in the app: sketch strip, settings window, grid and snap buttons, keep, list, reopen, undo and redo. Not checked in the app: Sketch Normal To Edge and the other plane buttons, the typed negative sign, kept curve drawing over the model, renaming and deleting a kept sketch.

S75-S82 sketch parity pass (2026-10-19, hand test needed in the app; unit tests and one Chrome pass covered typed sizes, slot, row of copies, dimension edit, reference toggle, Check sketch): conflict naming and per-point freedom with green placed geometry; collinear, lock, point to line distance, reference dimensions, ellipse short radius; move, rotate, scale, mirror and arrays on a selection; slot, three-point arc and circle, point, split tools; stepped long drags; constraint tags on the canvas; typed sizes while drawing; edit or toggle a dimension from the list; Check sketch and Join near points; plane through three vertices or an edge and a vertex. Not hand-tested: Mirror, Rotate and Scale prompts, circle of copies, split, three-point arc and circle previews, plane through points.

S64 primitive handle feedback (all items built), S13 dimension leaders (label overlap rule), S25 extra edges and faces (not reproduced; needs the owner's exact model and steps), S35 relationships and hole centres, S40 keyboard policy, S57 box select (retest window and crossing). S5-S16 were reviewed at the MVP merge.

## Design stance (input)

- Navigation: left selects and drags tools, wheel zooms toward the cursor, right-drag orbits, middle-drag pans (also during a tool drag). Pressing on a face or edge selects it and starts its drag in one motion; a press without movement is a click.
- Ctrl/Cmd+click toggles multi-select of one kind; dragging a selected item runs its tool on the whole selection.
- One drag sets one value; tools with several values get one on-screen handle per parameter (S28) and typed entry. While a drag is active, typing digits starts value entry (Tab switches fields, Enter commits, Escape cancels). Sign carries a second behavior where sensible (fillet outward, chamfer inward).
- A failed preview keeps the last good size and turns the status red; release commits the last good size. Previews use the glued boolean and may differ from the exact boolean at commit.
- Pixel constants (pick ranges, click-versus-drag threshold) live in settings or one named place, never inline.
- Edge ties within 2 px are broken by depth.
- Dev-server gotcha: Vite sometimes serves a stale module after files are rewritten by a script; restart `npm run dev` if the browser acts like old code.

## Kernel notes

- Python core with OpenCASCADE through OCP 8. API differences: collections live in `OCP.collections` (`IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher`, `List_TopoDS_Shape`); `TopoDS.Face(...)` has no `_s` suffix; use `Bnd_Box.CornerMin()/CornerMax()`; `BRepTools_History` has `IsRemoved`; booleans have no `HasWarnings()`.
- Booleans must be non-destructive (`SetNonDestructive(True)`) because previews run repeatedly on the document's shape.
- `ShapeUpgrade_UnifySameDomain` modifies its input in place and the boolean result shares sub-shapes with the document. Unify a `BRepBuilderAPI_Copy` of the result (test `test_push_pull_leaves_source_shape_untouched`).
- Previews use the glued boolean (`BOPAlgo_GlueShift`, 5-8x faster, wrong if the extrusion intersects other geometry); commits use the exact boolean.
- Pulling a face with holes leaves split faces in the hole walls (extrusion walls do not merge with the original cylinders); pushing is clean.
- Alternatives measured: `BRepFeat_MakePrism` (no face history), per-face `BRepOffset_MakeOffset` (clean but 2.5 s on the stress model; candidate for stretch).
- Performance: bracket preview 43 ms; the 410-face perforated plate stays about 1.5 s to mesh (per-face meshing overhead, not triangle count; see `history.md`). Tessellation is per-face numpy arrays with power-of-two deflection.
- Prototype preserved at tag `v0.1.0-poc`. Closest open-source competitor is Ductile (Rust, MIT, young); Chili3D is AGPL-3.0 so its code may be reused (`docs/research/landscape.md`).

## How to run

```
cd core
uv sync
uv run pytest
uv run python scripts/bench.py
uv run pliable-server        # ws://127.0.0.1:8765

cd app
npm install
npm run dev                  # http://localhost:5173, needs the server running
```
