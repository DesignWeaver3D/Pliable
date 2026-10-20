# Progress

Live status for the rebuild in [ROADMAP.md](../ROADMAP.md). Read this first in every session; commit rules are in [CONTRIBUTING.md](../CONTRIBUTING.md). Finished sessions are one line each in [history.md](history.md). Other files: [watchlist.md](watchlist.md) (shortcuts, guesses, limits), [decisions-log.md](decisions-log.md), [questions.md](questions.md) (owner questions only), [protocol.md](protocol.md) (core API), [testing-checklist.md](testing-checklist.md).

**Last unattended run (2026-10-19):** sketch parity pass S75-S82 (see Done, awaiting owner review and history.md), plus S73 partly. Everything is committed on `dev`, nothing pushed. Resume: wait for the owner's hand test of the new sketch features (list in the awaiting-review paragraph) and answers to questions 13-15; parked rows S73 and S74 need them. Tests at the end: 344 core, 121 node, typecheck and build passing.

Branches: work on `dev`; `rebuild` is the release candidate; `main` holds the MVP (`v0.2.0-mvp` tag preserves it). Last known state (2026-10-19, `dev` at the last commit): 331 core tests, 103 node tests, typecheck and build passing, no warnings. Nothing has been pushed; `dev` is ahead of `origin/dev`.

## Resume note

Start here (a new session): the build queue is empty except the parked S73 and S74. Every other open row needs the owner, so do not invent work; ask the owner for hand-test results or new requests. Run the tests first (`uv run pytest` in `core/`, `npm test`, `npx tsc --noEmit` and `npm run build` in `app/`; all pass today).
- **Owner's servers:** the owner's frontend runs on port 5180 against a core on 8770 (`VITE_CORE_PORT=8770`); a second core may run on 8765. Never stop them without being asked; after core changes the owner asks for a restart: stop the listener and its `uv run` parents, then `uv run pliable-server --port 8770` from `core/`. If the page says "Core not reachable", check the port the page was started with before anything else.
- **Parallel agents:** worktrees in `C:\dev\pliable-wt\<kernel|selection|shell|sketch>` are all merged and clean. Follow `docs/orchestration.md` including its "Keeping usage low" section: one agent per code area, related tasks to the running agent by message, one commit per task, cheap browser checks, no orchestrator re-test of a single clean merge.
- **Done this run (2026-10-18/19), awaiting the owner's hand test:** body list on the left with stable ids (S65), editable primitives (S68), double-click a face selects its body, hole model and handles and countersink conversion (S48), in-place dimension editing (S56), handles (S28, S47, S64, S66, S67, S69, S72: move arrows axis-coloured and fixed 80 px, radius and diameter handles, base-point picks, typed values on Enter), hole-centre snaps (S70), faster drags (S71), search upgrades, settings as entries, Getting started card, touch sizes, Tools handle with the toolbox icon, view controls beside the nav cube, drawer only from its handle or T, strip fitted to the width, axes sized from the whole project.
- **Not hand-checked in the app (agents verified only part):** Shift range select in the body list, rotate and scale of a body, Edit primitive from the row menu, moving a box before editing it, face and hole distance and draft angle dimension edits, Tab between dimension edits, hole gizmo diameter grip and move arrows, the pocket-or-slot message, cylinder and torus handles, chamfer handles, base pick on array tools, typed-on-Enter handle values, strip refit on window resize, touch targets on a real touch screen. The owner's checklist is `testing-checklist.md` (the owner keeps uncommitted edits there; do not overwrite them).
- **Known limits:** body ids after an operation are matched by shape and volume (watchlist); after a hole edit the selection is dropped; the draft-angle dimension assumes a Z pull direction.
- **Owner decisions in force:** first alpha release deferred (S17, no tag); question defaults used for holes; see `docs/decisions-log.md`.

## Open sessions

| # | Area | Goal | Status |
|---|---|---|---|
| S17 | Alpha | Portable alpha build (PyInstaller, one launcher, CI smoke tests on four OS targets). Built and CI-verified. Deferred by the owner (2026-10-19): the first alpha release waits because the current progress is large; do not tag or publish | Deferred, owner decision |
| S30 | Sketch | Sketching reliable and fluid. Done: closed regions become faces on Finish sketch, centre rectangle with corner options, offset, round/bevel corner, projected model edges, snaps to curves/midpoints/axes/references, alignment guides, live size tags, circle/line/arc auto tangency, body drag, Alt+click zone cycling, box select of zones | Remaining: lift the alpha "unsupported" label after the owner tries sketching; kept sketches (not stored today) |
| S34 | UI | GUI layout rework from `docs/research/gui-plan.md`. Built: floating top-centre strip (drag tool first, as many tools as fit the width plus "N more / All tools"), browse drawer (Tools handle on the left edge of the view, T, usable-now filter; handle icon is a placeholder, constant TOOLS_HANDLE_ICON in icons.ts), slim top bar with Menu popup, permanent search field (Ctrl+K or /), gear at top right, procedural icons beside labels (contact sheet `app/icons.html` on the dev server), measurement card collapsed by default. Owner decisions still apply (dark only, owner reviews every icon, touch only while cheap) | Remaining: owner reviews the icons; search keywords, scope prefixes, recents, searchable settings, Getting started card and touch sizing are done (see history); a printable shortcut sheet and real-device touch testing are not done. Strip stays fixed top centre (following the selection is an experiment) |
| S73 | Cleanup | Shared newest-wins preview scheduler (`app/src/latestwins.ts`, unit tested). Done: the hole centre drag uses it (not hand-checked in the app). Parked: the push/pull drag (`pump`) and form previews (`drainPreviews`) keep their own copies because they carry extra state (last good size, failure flags, sequence checks); moving them is a risk with no user-visible gain | Parked |
| S74 | Sketch | Profile faces cannot be picked or dragged with the push/pull arrow yet (extrude is on the sketch's row); sketch curves are not selectable or snappable. Sketch parity items parked, needs owner direction or a different solver: shape constraints for ellipses and splines (a different solver is needed; the only candidate wheel has no macOS build), control-point splines with weights, hyperbola and parabola arcs, live (non-snapshot) projected edges (question 10), offset or angled sketch planes from a face, plane tangent to a surface (normal to an edge is done); kept sketches are built (S83, awaiting the owner's hand test) but not yet usable as sweep rails or array paths | Parked |


## Done, awaiting owner review

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
