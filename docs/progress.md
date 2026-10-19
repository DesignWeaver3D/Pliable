# Progress

Live status for the rebuild in [ROADMAP.md](../ROADMAP.md). Read this first in every session; commit rules are in [CONTRIBUTING.md](../CONTRIBUTING.md). Finished sessions are one line each in [history.md](history.md). Other files: [watchlist.md](watchlist.md) (shortcuts, guesses, limits), [decisions-log.md](decisions-log.md), [questions.md](questions.md) (owner questions only), [protocol.md](protocol.md) (core API), [testing-checklist.md](testing-checklist.md).

Branches: work on `dev`; `rebuild` is the release candidate; `main` holds the MVP (`v0.2.0-mvp` tag preserves it). Last known state: 193 core tests, 21 node tests, typecheck and build passing.

## Resume note

Wave 2 (2026-10-18) is merged into `dev` (243 core tests, 37 node tests, typecheck and build pass). The agent branches in `C:\dev\pliable-wt\<name>` are fully merged. Not hand-checked in the app: import and export, hole-wall push/pull, draft, Shift+click, Ctrl+double-click, small-face picking, closing a spline, All/None chips, Symmetric chip, search entries and tooltips. The owner's core on 8765 must be restarted to pick up the merged code. Next: the owner's hand test (`testing-checklist.md`), then S48 full scope, S56.

## Open sessions

| # | Area | Goal | Status |
|---|---|---|---|
| S17 | Alpha | Portable alpha build (PyInstaller, one launcher, CI smoke tests on four OS targets). Built and CI-verified | Remaining: run the workflow on a test tag (a tag creates a draft release; needs the owner) and the owner's Windows check |
| S30 | Sketch | Sketching reliable and fluid. Done: closed regions become faces on Finish sketch, centre rectangle with corner options, offset, round/bevel corner, projected model edges, snaps to curves/midpoints/axes/references, alignment guides, live size tags, circle/line/arc auto tangency, body drag, Alt+click zone cycling, box select of zones | Remaining: lift the alpha "unsupported" label after the owner tries sketching; kept sketches (not stored today) |
| S34 | UI | GUI layout rework from `docs/research/gui-plan.md`. Built: floating top-centre strip (drag tool first, 7 tools plus "All tools"), browse drawer (Tools handle on the left edge of the view, T, usable-now filter; handle icon is a placeholder, constant TOOLS_HANDLE_ICON in icons.ts), slim top bar with Menu popup, permanent search field (Ctrl+K or /), gear at top right, procedural icons beside labels (contact sheet `app/icons.html` on the dev server), measurement card collapsed by default. Owner decisions still apply (dark only, owner reviews every icon, touch only while cheap) | Remaining: owner reviews the icons; search keywords, scope prefixes, recents; settings as a searchable window; learning aids (first-run card, shortcut sheet); touch sizing. Strip stays fixed top centre (following the selection is an experiment) |
| S48 | Holes | Define what a hole is and how users interact with one (`docs/research/holes-scope.md`, questions 1-4). Owner prefers a hole axis line with end points over a centre point; picking a circular hole edge must expose the circle's centre. Interim: show hole centre dots only on hover or selection, or behind a setting | Interim done (centre dots only for the hovered or selected hole; a selected circular edge shows its centre). Full hole scope waits on questions 1-4 |
| S56 | Measure | Edit displayed dimensions in place (hole diameter, fillet radius, edge length, face-to-face distance, face angle; one undo step; red reason when impossible). Research done; discuss with the owner, then scope a build | Planned, needs owner |
| S64 | Gizmos | Owner feedback on the primitive handles: move arrows use the axis colours and point in the positive direction, and look different from resize handles; a pick point can set the base point of a move (not only the destination), so the object origin is not the only anchor; resize handles on all six sides of a box (the opposite side extends the other way, moving the origin), with the same flexibility designed per primitive type (cylinder, sphere, cone, torus) | Done, awaiting owner: move arrows are axis-coloured and positive-pointing, resize grips are neutral squares; base-point pick for move body, move hole, pattern hole, linear array, and a base-point list for primitives; resize grips on all faces/ends of the five primitives. Not hand-checked: cone, sphere, torus grips in the app (tested in core), Pick base point on arrays |
| S65 | Bodies | Body list, decided with the owner 2026-10-19. (1) Stable body ids and names in the core carried through operations by face history; auto names from the tool that made them (Box 1, Cylinder 2), STEP part names kept on import. (2) A plain list (rows, no card chrome) on the left, as a section of the left drawer under the tools. (3) Each row: name, eye (hide/show), isolate toggle; a right-click context menu with Rename and room for future actions (delete, duplicate). (4) Clicking a row selects the whole body (Ctrl adds, Shift takes a range) and lights up its faces; move, rotate, scale and offset use a selected body directly and pivot about its centre, falling back to the face method when faces are selected. (5) Hovering a row highlights the body in the view, and selecting a body in the view highlights its row; a double-click on a face selecting its whole body comes later | Planned, after S67 |

## Done, awaiting owner review

S13 dimension leaders (label overlap rule), S25 extra edges and faces (not reproduced; needs the owner's exact model and steps), S35 relationships and hole centres, S40 keyboard policy, S57 box select (retest window and crossing). S5-S16 were reviewed at the MVP merge.

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
