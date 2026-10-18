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
