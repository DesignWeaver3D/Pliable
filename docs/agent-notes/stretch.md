# Stretch hand-off (branch agent/stretch, worktree C:\dev\pliable-wt\stretch)

## Where to continue
- Worktree `C:\dev\pliable-wt\stretch`, branch `agent/stretch` (keep both as they are; never touch `C:\dev\pliable`, never push).
- Ports: core 8801, frontend 5201 (never 8765, 8770 or 5180). Data folder: `C:\dev\pliable-wt\stretch\.agent-data`.
- In PowerShell first: `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`
- Core (from `core\`): `$env:PLIABLE_DATA = 'C:\dev\pliable-wt\stretch\.agent-data'; uv run pliable-server --port 8801`
- Frontend (from `app\`): `npm run dev -- --port 5201 --strictPort` (`app\.env` sets `VITE_CORE_PORT=8801`); open http://localhost:5201
- Dependencies are installed (`uv sync` in `core\`, `npm ci` in `app\` were run).
- Tests: core `uv run pytest -q` from `core\` (about 160 s, use a 300 s timeout; read the last line); the stretch files alone: `uv run pytest -q tests/test_stretch.py tests/test_stretch_band.py tests/test_card_gizmos.py`; after changing a tool's parameters regenerate the registry with `uv run python tests/test_tool_registry.py`. App from `app\`: `npm test` (check with `Select-String '^ℹ (pass|fail)'`), `npx tsc --noEmit`, `npm run build`.
- Specification: `docs/progress.md`, row "Box-select stretch on any solid" (do not edit that file or `docs/author-guidance.md`).

## Commits so far
- `638dae4` the `core/src/pliable/stretch/` package; `9219110` the tool wired to it, tilt/frame/pivot/band/continuity parameters, rings and band slider handle; `12963d7` `core/tests/test_stretch_band.py` (14 cases, all pass); `c1f1522` app: band slider (`app/src/bandslider.ts`, hooks in `manipulatordrag.ts`, `manipulator.ts`, handle type in `tools.ts`); the last commit adds these notes, the watchlist and decision entries, and the result note on commit.
- Test state at hand-off: core full suite 919 passed before the band tests were added; stretch, band, gizmo and core test files pass (91); app `npm test` 524 pass / 0 fail, `tsc` and build clean (reported by the app agent).

## What is built (core)
`tools/stretch.py` `Stretch.run`: mode 0 calls `stretch.solve.stretch(...)`; if that refuses and one flat face was moved straight along its normal without tilt, it falls back to `insert_solid` (old behavior); mode 1 is unchanged. `shift_vertices` stays for `tools/move_edge.py`. `Stretch._plan` caches zones and band on the Topology object (`_stretch_plans`), so a drag step does not redo them.

Package `core/src/pliable/stretch/`:
- `body.py` `Body`: faces, edges, vertices of one solid numbered in the kernel's map order, adjacency, `edge_samples`, `outer_edges`.
- `zones.py` `sort_zones`: protected = selection (plus faces whose corners are all protected, plus end fillets tangent to a protected face along their length); rubber = faces with some protected corner; fixed = the rest.
- `band.py` `layout` -> (`Zones`, `Band`): direction = sum of the protected faces' area normals (`_area_vector`), flipped so the rubber is below; `end` = lowest level of the protected boundary; `limit` = highest level of fixed geometry that is not an island; `features` = islands (fixed faces bounded only by inner loops of rubber faces: holes, pockets, bosses). An island level with the protected part joins it. `Band.start(length)` gives the band start and the riders (0 = Auto: nearest feature).
- `falloff.py` `Falloff`: share of the move per level, constant across riders; orders LINEAR, TANGENT (cubic), CURVATURE (quintic).
- `field.py` `Move` (turn about a pivot, then shift) and `Field` (straight: lines along the direction stay straight; otherwise each point takes its share of turn and shift).
- `continuity.py` `creases` (would the straight ramp show a crease) and `folds`.
- `deform.py` `Deformer.run`: per rubber face SAME (the move slides it along itself), PLANE (deformed samples are flat), ROUND (fitted face is a cylinder or cone), FREE (fitted cubic B-spline at the old (u, v); flat faces are fitted in (u, v) turned so u runs along the band). Edges: rigid, kept line/circle with a new range, new line, or fitted curve at the old parameters. Curves on faces: copied, `GeomAPI.To2d_s` on planes, sampled on round surfaces.
- `fit.py` `Span` (knots, with repeated knots at the band's levels, sampled at Greville sites), `SurfaceFit`, `fit_curve`, `fit_curve_2d`.
- `recognize.py` plane / cylinder / cone helpers. `rebuild.py` `rebuild` (same topology, new geometry, tolerances from measured gaps; `drop` leaves island faces out) and `unchanged`.
- `shorten.py` `overrun_features`, `remove_features` (lift out, kernel feature removal as fallback). `solve.py` `plan`, `stretch`. `frame.py` frame axes, pivot, `rigid_move`. `gizmo.py` arrows, rings, `band_handle` (Handle fields `rest`, `strip` added in `tools/base.py`).

## Decisions taken (also in docs/decisions-log.md)
- Straight ramp where it leaves no crease (keeps the old exact taper and shear results); G1/G2 easing only where needed.
- End fillets and islands level with the protected part move with it. Tilt pivot = center of the selected part.
- Overrun features are lifted out by dropping faces and inner loops (53 s -> 3 s on the 400-hole plate), a row at once.

## Checklist status
Zones, topology kept, local band with Auto, riders in a widened band, recognition (plane, cylinder, cone) and face merge, shortening with removal, continuity option, tilt and frame parameters, handles, tests: done in core. Not built: re-making deformed fillets at their radius; sphere/torus recognition after a real change. App: band slider done; NOT started: band strip shading (handle `strip`), Stretch card (Pick face / Pick edge / Pick pivot buttons, hiding fx fy fz frame_edge, fa fb fc only for Free, px py pz only for Picked point, labels), showing `notice` on commit (`app/src/modelview.ts` ~line 51 shows it for previews only), checking the preview goes through `latestwins.ts`, the Chrome check.

## Exact next steps
1. Run the full suites once (`uv run pytest -q` in core\, 300 s timeout; `npm test`, `npx tsc --noEmit`, `npm run build` in app\).
2. App steps 3-5 above (the prompt text is in this file's "NOT started" list; new files `app/src/bandstrip.ts`, `app/src/stretchcard.ts`).
3. Measure preview time per drag step with a free-form result (script idea: 4 `Tool.execute(..., preview=True)` calls with changing dz on the perforated plate and the bracket). Measured so far on the 800-face plate: straight stretch 0.14 s per step after a 1.4 s first step (zones); a sideways slide (2 free-form faces) about 3.7 s for the first step, later steps not measured. If slow: time is in `Deformer._fit_surface` and the gap check in `rebuild._deviation`.
4. Chrome check on 8801/5201 (bar with a middle hole: box-select an end, drag, strip and preview, undo).

## OCP notes
- Worked: `BRep_Builder` hand rebuild (MakeVertex/MakeEdge/UpdateEdge with one or two curves on a face/Range after the pcurves/MakeFace/MakeWire/MakeShell/MakeSolid); `BRep_Tool.CurveOnSurface_s(edge, face, 0.0, 0.0)` (reversed edge gives the second seam curve); `TopoDS_Iterator(shape, False, True)` for stored orientations; `ElSLib.Parameters_s`, `ElCLib.Parameter_s`; `GeomConvert_SurfToAnaSurf(surface).ConvertToAnalytical(tol)`; `GeomAPI.To2d_s`; `IntTools_FClass2d`; arrays are `OCP.collections.Array1_gp_Pnt`, `Array2_gp_Pnt`, `Array1_double`, `Array1_int`, `Array1_gp_Pnt2d`; `gp_Quaternion.GetVectorAndAngle(vec)` returns `(angle,)`.
- Did not work: subclassing `BRepTools_Modification` in Python (no constructor); `OCP.TColgp` / `OCP.TColStd` array names; `BRepTopAdaptor_FClass2d`; `BRepCheck_Result.Status()` (unregistered list type); `Bnd_Box.Get`.

## Pitfalls
- Measure edge-to-face gaps off the sample grid (`rebuild.OFF_GRID`): a fit is exact at its samples and the kernel's validity check samples elsewhere.
- A G1 ramp is only once differentiable: without repeated knots at the band levels the fit converges slowly and the solid fails the validity check.
- Bash heredocs containing triple quotes fail in this shell; write helper scripts with the Write tool.
- The band direction is fixed from the first selection; do not recompute it after islands join the protected part.
- Commit with explicit paths when another agent works in the same worktree.

## Status (second session)
- Main merged (967 core, 540 app tests pass).
- Stretch card done: `app/src/toolformframe.ts` (Pick face via pickPlane, Pick edge via pickEdgeId, Pick pivot via pickPoint; fx fy fz frame_edge always hidden, fa fb fc only for Free, px py pz only for Picked point) and labels in `toolparamhelp.ts`. Owner to judge by eye: layout of the buttons under Axes and Tilt pivot.
- Band strip shading done: `app/src/bandstrip.ts` (translucent layer on the rubber faces, clipped by two planes), driven by `Manipulator.onStrip` (also while the slider is dragged). Limitation: it is drawn in the committed (unmoved) coordinates, so during a preview it covers the original band slab, not the stretched one. Owner to judge by eye.
- App tests 542 pass; tsc and build clean.
- Result notice now shown on commit and kept in the status line during a preview (main.ts); before, the preview line overwrote it. The Stretch preview uses main.ts's own latest-wins (previewWaiting/drainPreviews), same as every tool; latestwins.ts is used only by holecentremove.ts, so no change there.
- Preview timing (free-form sideways slide, steps of dz): perforated plate 0.2-0.3 s per step; bracket 1.1-1.6 s before, 0.27-0.44 s after speeding up `stretch/fit.py` (time was `np.linalg.solve` in the fits: the collocation inverse is now cached per span across steps, `basis` is vectorized, `SurfaceFit.at` uses a matrix product). Same results to rounding; stretch tests pass.
- Fillet re-making done (commit 105b2a5): `stretch/refillet.py`, called at the end of `solve.stretch`; test `test_lengthwise_fillets_stay_round_when_the_end_slides_or_tilts`. Not re-made: cone/torus/sphere or variable-radius fillets. Core full suite 969 pass.
