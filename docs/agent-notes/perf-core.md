# perf-core agent notes (branch agent/perf-core)

Measured on the 114-body STEP (8219 faces), `C:\dev\pliable-wt\perf\pc_base.py` (import, warm move, 3 moves in a row without undo, undo x3, push/pull, undo). Seconds per reply.

| step | baseline | after per-body display data |
|---|---|---|
| move 1 (first after import) | 15.6 | 15.6 |
| move 2 in a row | 6.4 | 4.8 |
| move 3 in a row | 6.3 | 3.2 |
| undo (between merged states) | 1.8-2.2 | 0.4-0.7 |
| push/pull from the import state | 5.0 | 5.0 |
| undo back to the import state | 4.3 | 4.3 |

`tessellate()` in a merged state: 3.4 s before, 0.26 s after (move 3: the remaining 3 s is the operation itself: tool, face merge, document push).

## Findings
- Push/pull (4.2-4.4 s in `tessellate`) is NOT whole-model re-meshing: `meshing.mesh` is 0.25 s and 12 faces are stale. It is per-face Python: the import state has 159 faces/edges outside any solid, so `_solid_indices` takes its slow lookup path (0.5 s) and `split_centre` (wall chain lookups, 2.0 s) runs on every partial cylinder face. After the first operation the loose shapes are gone (7033 faces) and the model takes the fast path.
- The same-state steady `tessellate()` is 4.1 s at the import state vs 1.8 s merged.
- Every operation ends in `merge_faces`, which copies the whole model's topology (`BRepBuilderAPI_Copy`, geometry and triangulations shared). No body keeps its TShape, so a shape key never hits; the face triangulation objects are what survives. The per-body key is therefore the triangulations, locations and orientations of all faces plus counts, deflection and preview (`bodydisplay.py`).

## Status
- Task 1 (per-body display data): done for models where every body owns its ids as one block (no loose faces, nothing shared). The import state (loose faces) and shared-sub-shape models still take the whole-model path (`tessellate_whole`). Making the import state fast needs either the loose shapes handled per range or fixing the 2 s `split_centre` cost; not done (it is the first operation only).
- Task 2 (move by placing): done. `move_body.py` now applies the move with `Shape.Moved(TopLoc_Location(trsf))` instead of `BRepBuilderAPI_Transform(..., True)`; a move and a turn are rigid so a location holds them. Geometry (vertex positions within 1e-7), counts and ids are the same as the transformed copy (test), save/open and STEP export of a placed body round-trip (test). Timing: no visible change on the 114-body model (only the moved body's 9 faces keep their mesh; the earlier 2014 re-meshed faces come from the first merge after import, not from the move). Display triangles of a moved body are now the old triangles transformed, not a fresh mesh of the moved geometry, so node layout of a rotated curved face can differ from before at rounding level.
