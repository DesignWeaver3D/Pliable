# Kernel agent notes (S22, S23, S24, S25, S37)

## S22 - Done (Tier 1 all built; thicken surface parked earlier, see parity-plan Parked table)
## S23 - Done/parked
Built earlier: variable fillet, loft, sweep, array along path, offset curve, construction planes at offset, polygons/trim/extend.
Parked this run (decision, no owner): ellipse/spline sketch curves (py-slvs has no ellipse/spline, belongs to the sketch agent), project curves onto faces, groups/layers/colours (document model change). Measure between entities already exists (`measure.py` pair rows).
## S24 - Done (built patch fill and bridge; fillet setbacks, G2, deform, T-spline parked in parity-plan).
## S25 - Done as far as possible without the owner
Added `core/tests/test_seams.py`: out-and-back push/pull, boss+fill, hole+fill, fillet/chamfer+remove round, union+subtract, all with face/edge count equality and a no-mergeable-seam check. A sweep of every one-face/one-edge tool on the bracket left no seams. Merge cost measured (0.4 s on 231 faces), logged in watchlist. Not reproducible; still needs the owner's exact model/steps; remaining suspicion is a stale hover/edge display line in the viewer (frontend, selection agent's area).
## S37
Done by criteria: Resize fillet switches constant/variable via end radius (tested). Variable chamfer impossible in the kernel. PARKED: per-edge list in one form (needs a dynamic parameter form in the UI, a shell/UI change). If the owner wants it, change: add a per-edge radius list param kind and render it in the tool form.

## Decisions without the owner
- Parked ellipse/spline, project curves, groups/colours (reasons above); change by scheduling them as new sessions.
- S25 closed as not reproducible in the kernel.

## Resume point
All five sessions Done or Parked; nothing half-done. 166 tests pass.

## S29 core - Done (core only)
Multi-solid documents already worked (compound of solids, per-solid ids, hide/isolate, `body_boolean` as the explicit join). Added `new_body` param (1 default = own body, 0 = fuse) to add_box/cylinder/sphere/cone/torus via `_add_material` in features.py. Sketch extrude and revolve accept mode `new`; the request default mode is now `new` when the client omits it. Frontend: only a "New body" option in the extrude mode select in `sketch.ts` (UI default remains Join). Tests in test_multisolid.py (defaults, boolean join, undo/redo, STL/STEP export, sketch extrude).
Decisions (change if the owner disagrees):
- Default separate for primitives and server-side extrude; sketch UI default left at Join because extruding a sketch drawn on a face is normally meant to add to it. To default the UI to a new body, change the initial `mode` in `sketch.ts` (two places).
- add_boss, array copies, and push/pull stay joining (they are features of a body, not new bodies).
- Param is a number, not a checkbox (no boolean param kind); a real checkbox belongs to the post-S34 form work.
Open: move/rotate/scale act on the whole model, not a picked body (owner wants single/group moves); next step is a per-body selection for move_body etc.
Resume: S29 core done; per-body move is the next piece. 185 tests pass.

## Bug: inset/divide face were no-ops in the app
Cause: Tool.execute merges coplanar faces after every tool (S25), undoing the intended split. Fix: inset_face and divide_face return `unified=True` so execute skips the merge. Audited: cut_plane, split_plane, patch_fill, bridge already go through execute in tests and are fine; sketch_regions and the unwrap imprint commit directly and never hit the merge. Tests in test_edgesel.py now use execute.

## Wave 2b

### S29 per-body move - Done (core; frontend unchanged)
move_body, rotate_body, scale_body and offset_body now accept selected faces (0 or more) and change only the solids that contain them (`_on_bodies` in features.py); with nothing selected they act on the whole model as before. Selecting faces from two bodies moves both (group). Undo, hide/isolate and exports needed no change (several solids already worked). Tests in test_multisolid.py drive Session.handle (tool_commit, undo) with two separate bodies. No frontend change was needed: the existing tool buttons already appear once faces are selected.
Decisions (change if the owner disagrees):
- Selection by faces only (there is no body selection in the UI until S34); the owning solid is found by face identity.
- Rotate and scale still pivot about the model origin, not the body centre (so a scaled body also drifts). A per-body pivot (centre of the body) is a one-line change in the two tools if wanted. Logged in the watchlist.
- Edges and vertices selected alone still make these tools unavailable.

### Task 2 - Chrome checks (own tab, port 5201/8801)
- Add box + Move body on one face: Model info stayed 2 solids, bracket stayed put; group move with a face from each body moved both; undone.
- Combine bodies (union) of overlapping box and bracket: 1 solid. The one open edge reported is genuine: the test box corner touches a hole wall tangentially (hole at x 25, y 14, radius 4; box edge at y 10); not a bug.
- Fillet per edge apply on the 10 top face edges: worked, but found a BUG: with the edges in the order the app lists them, the result had 2 stray zero-length open edges at the corners. Fixed by adding edges in id order in fillet_per_edge and fillet_chamfer (commit f7da101, regression test in test_features.py). Re-verified in the app after the fix: 31 faces, 0 open edges. Undone.
- Sketch extrude with mode New body (rectangle on XY plane beside the bracket): 25 faces, Model info 2 solids, valid. Undone.
Not checked in the app: rotate/scale/offset of a single body (core tests only), hide/isolate with several bodies, exports of several bodies in the UI.

### Resume point
All Wave 2b items Done. Nothing half-done. Next ideas: body pivot for rotate/scale; a real body picker after S34.
