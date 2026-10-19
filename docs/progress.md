# Progress

Live status for the rebuild in [ROADMAP.md](../ROADMAP.md). Read this first in every session; commit rules are in [CONTRIBUTING.md](../CONTRIBUTING.md). Finished sessions are one line each in [history.md](history.md). Other files: [watchlist.md](watchlist.md) (shortcuts, guesses, limits), [decisions-log.md](decisions-log.md), [questions.md](questions.md) (owner questions only), [protocol.md](protocol.md) (core API), [testing-checklist.md](testing-checklist.md).

Branches: work on `dev`; `rebuild` is the release candidate; `main` holds the MVP (`v0.2.0-mvp` tag preserves it). Last known state: 193 core tests, 21 node tests, typecheck and build passing.

## Resume note

Parallel wave stopped at the usage limit (2026-10-18). Work sits on unmerged agent branches in `C:\dev\pliable-wt\<name>`; merge in the order kernel, selection, sketch, shell, running core tests, `npm test`, `tsc` and the build after each.
- **selection** (done, 222 core / 29 node tests): S51 see-through faces, S50 chips (off by default, All/None, Parallel, Symmetric), S48 interim hole centres. Not hand-checked: All/None, Symmetric chip, snap. Expect conflicts in `index.html`, `reference.ts`.
- **shell** (done, 35 node tests): S53 any modifier mix, S54 dimensions with extension lines and leaders, S55 hint line and tips. Not hand-checked: tooltips, dialog checkbox, search entries. The M key is hard-coded in `viewport.ts` (cannot be rebound).
- **kernel** (partly done; committed: array the chosen body S49, Center between faces needs one side face S52). Uncommitted in the worktree: S36 stretch spike (`stretch.py`, `test_stretch.py`, edit to `tools.py`), untested. S47 core half not started.
- **sketch** (partly done; committed: one Sketch On Face button with visible automatic constraints, axes and vertices projected into a sketch, i.e. S43 and most of S45). Uncommitted: `unwrap.py` and `test_unwrap.py` changes toward S46. Free-drag fix, S44 not done.
Next: review the uncommitted work in kernel and sketch (run its tests; commit if green), merge, then assign S60-S63 and the leftovers.

## Open sessions

| # | Area | Goal | Status |
|---|---|---|---|
| S17 | Alpha | Portable alpha build (PyInstaller, one launcher, CI smoke tests on four OS targets). Built and CI-verified | Remaining: run the workflow on a test tag (a tag creates a draft release; needs the owner) and the owner's Windows check |
| S28 | Manipulators | On-screen handles (gizmos): a tool declares one handle per parameter and the view draws them. First users: primitive placement and sizing, then move/rotate/scale, push/pull, fillet. Typed entry stays secondary. A tool declares whether it starts from a selection or from the tool. Done when a box, cylinder and sphere are placed and sized with handles | Planned |
| S30 | Sketch | Sketching reliable and fluid. Done: closed regions become faces on Finish sketch, centre rectangle with corner options, offset, round/bevel corner, projected model edges, snaps to curves/midpoints/axes/references, alignment guides, live size tags, circle/line/arc auto tangency, body drag, Alt+click zone cycling, box select of zones | Remaining: lift the alpha "unsupported" label after the owner tries sketching; kept sketches (not stored today) |
| S34 | UI | GUI layout rework from `docs/research/gui-plan.md`, built in stages with screenshots. Owner decisions: floating context strip fixed top centre; permanent small search field in the top bar; labels beside icons; no radial menu; with nothing selected the strip offers create tools; a browse drawer replaces the left tool list; dark theme only; owner reviews every icon (procedural icons fine, follow solid-modeling conventions); touch only while cheap. Open: should the bottom-left card show context data (selection, measurement, body info)? | Planned |
| S36 | Stretch | Headless stretch spike per `docs/research/reference.md` (owner answers confirmed: default keep end size, toggle keep angle, refuse with a one-click insert fallback, all-vertices-selected means moved); timeboxed, park with notes if it stagnates | Planned |
| S43 | Sketch | Unconstrained geometry must move freely (solver moves only what constraints need); one Sketch On Face button that works with the face selected before or after, curved faces unwrap automatically (no separate unrolled button); an unsupported face offers the diagnostic report. Build order per `docs/research/sketch-placement.md`: free-drag fix, single button, unsupported-face fallback, principal and view planes. The sketch agent could not reproduce the floating bug (solver has no dragged-parameter list; free lines and circles stay put); suspect automatic constraints (question 12) | Planned |
| S44 | Sketch | Ellipse and spline: keep the current solver for lines, arcs and circles and add own entities with endpoint constraints only (replace the solver only if full shape constraints are needed; question 9) | Planned |
| S45 | Sketch | Projected axis lines in a sketch, and snapping to projected points and edges that are off the sketch plane. Projection stays a snapshot: project axes and vertices always, tilted circles as ellipses, edges square to the plane as points, and report skipped edges | Planned |
| S46 | Unwrap | Several adjacent faces (three sides and two fillets) as one sketch face; distortion on non-developable surfaces is accepted and must be obvious. Cylinders, cones and tangent chains already work | Planned |
| S47 | Gizmos | Fillet/chamfer manipulators: reverse ends or another way to say which end gets which value, interim radii at chosen points along the edge, chamfer distances that differ per side, all within the kernel. After S28 | Planned |
| S48 | Holes | Define what a hole is and how users interact with one (`docs/research/holes-scope.md`, questions 1-4). Owner prefers a hole axis line with end points over a centre point; picking a circular hole edge must expose the circle's centre. Interim: show hole centre dots only on hover or selection, or behind a setting | Planned |
| S49 | Arrays | Every array tool arrays a chosen feature or body instead of the whole solid | Planned |
| S50 | Intent | Relationship chips redesign: all or none plus per-chip include/exclude; until defined, chips are shown but not included in the selection; add chips such as parallel faces and symmetry | Planned |
| S51 | Selection | See-through makes faces transparent (not the whole solid) with edges clearly visible, and is discoverable in the interface | Planned |
| S52 | Tools | Center between faces is unreachable in the interface; make it usable | Planned |
| S53 | Keys | Any combination of Ctrl, Alt and Shift may be a modifier. Other key topics are discussed with the owner one at a time (questions.md) | Done |
| S54 | Measure | True dimensions (extension lines, dimension line, arrowheads) for lengths and distances, and leaders (text with a line pointing at a feature) for radii and holes. Today they are plain labels | Done |
| S55 | Discovery | Make hidden modes discoverable, starting with the measure pick (M during a drag) and see-through: one hint line at the bottom of the view, tooltips with shortcuts, searchable names for hidden modes, a dismissible first-use hint (`docs/research/interaction-patterns.md`) | Done |
| S56 | Measure | Edit displayed dimensions in place (hole diameter, fillet radius, edge length, face-to-face distance, face angle; one undo step; red reason when impossible). Research done; discuss with the owner, then scope a build | Planned, needs owner |
| S60 | Bugs | Owner checklist, edit faces: Push/pull on a hole wall does nothing; rename Delete face to Defeature, make it work on non-circular features and give a reason when it fails; align_face is greyed out and unexplained (make it reachable with a tooltip or park it); draft does not work | Each works in a hand test or fails with a clear message | Planned |
| S61 | Bugs | Export: STL/OBJ/3MF is not in the interface (add buttons or palette entries and check Ctrl+K lists them); Export STEP asks for no name, type or destination (use the browser save dialog where available); Open STEP does not warn that it replaces the model and offers no add to the current session (merge with Combine STEP into one Import choice) | Export and import behave as described | Planned |
| S62 | Bugs | Selection: Edge loops and All edges give the same result, so Edge loops should select only the perimeter loop (or be renamed); Ctrl+double-click on an edge behaves unexpectedly and the double-click chain sometimes adds non-tangent edges; Shift+click creates chips with no obvious next step; small faces and edges are hard to pick | Hand test of each | Planned |
| S63 | Bugs | Measurement panel and leaders sometimes stop updating after other tools until the tab is reloaded: reproduce, then fix. Also check why the page shows "core stopped" and does not reconnect after a dropped connection (owner's 5180 session, 2026-10-18; the core was still running) | Repro found and fixed, or parked with notes | Planned |

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
