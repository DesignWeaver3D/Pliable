# Tool audit: speed and correctness lessons (agent/stretch)

Scope: every tool in `core/tests/tool_registry.json` (62 tools). Read from the code; times are `Session.handle` commits on the owner's enclosure
(`AD5M_Enclosure.STEP`, 120 bodies), a body from the middle of the size list, a flat face / edge of it, after three moves to settle the model, each
undone after the timing. Scripts: `.agent-data` (not committed). Correctness: `core/tests/test_tool_other_bodies.py` (a five-body model, an independent
volume oracle per tool; known failures are marked expected-to-fail with their reason).

Lessons: (a) merge only the changed bodies (`mergescope.finish_scoped`, or `finish(..., changed=)`), (b) cut other bodies one at a time
(`shared/bodycut.py`), (c) move by placement (`move_body`), (d) no whole-model measures (bounding box, volume), (e) carry the merge memory
(`mergememo`, applied to every tool by `handlers/tools.py` after a tool when the start model was marked merged, but it only helps a tool that leaves the
unchanged bodies the very same shapes).

Reading the table. `narrowed` = the tool declares `scope_to_bodies`, or `skips_hidden_bodies` with the interaction setting (default "This body"): the tool
sees only the bodies that own the selection (`body_scope.narrow`), so its merge, cut and measures cover those bodies only; with "Other bodies" it sees every
visible unlocked body (the whole model on the enclosure). `W` = whole (narrowed) shape. Every tool that does not set `merged` leaves the result unmarked, so the
next Move/Rotate or hole has to merge the whole model again (about 5.5 s of the times below is that merge on the enclosure).

## Findings first

Correctness failures (all with an expected-to-fail test in `core/tests/test_tool_other_bodies.py`; the model is five bodies, "overlap" = C reaches into B):

| Tool, setting | What goes wrong |
| --- | --- |
| Slot, Other bodies, tool crossing overlapping bodies | 2,203 mm3 of material left inside the slot (removed 2,528 of 4,731 mm3). Whole-model cut. On the enclosure the same call takes 51 s and turns 120 bodies into 231 (see below). |
| Boss, Other bodies, across overlapping bodies | 14,593 mm3 of material lost (result holds 56,345 of 70,937 mm3). |
| Push (negative) with Other bodies, reaching into an overlapping body | 400 mm3 of the second body left inside the cut (overlap cut once). |
| Pull with Other bodies | The prism fuses into the pulled body only; the bodies it crosses stay in place overlapping it (16,000 mm3 held twice), with or without overlapping bodies. The union volume is right. |
| Revolve Subtract, Other bodies | 1,345 mm3 left inside the swept shape. |
| Revolve Add, Other bodies | the swept pieces come back as solids of zero volume and the crossed bodies are not joined. |
| Revolve Add, This body (half turn about a far axis) | "Operation produced invalid geometry". Less controlled case; confirm before fixing. |
| Primitive joined to the model (new body off) across overlapping bodies | 22,089 mm3 of material lost. |

Whole-model booleans do not run at all on the enclosure ("Boolean operation failed" after 0.3 s): Boss (Other bodies), primitives joined to the model, Mirror, Linear/Circular
array of a body or of a hole, and Path array (which fails only after 162 s). The enclosure has bodies that overlap or share sub-shapes, which these
whole-model fuses cannot take.

Correct in the tests (both settings, overlapping or not): new Hole (through and blind; body by body, lesson b), Slot and Boss with This body, Push/Pull with This body, Body boolean (union, subtract: only
the chosen bodies change), Mirror, Linear array, Cylinder primitive when the bodies do not overlap, Revolve with This body Subtract (refused when it meets nothing of its own).

## Recommended fix order (time saved if fixed, correctness first)

1. Slot with Other bodies: use `cut_reachable_bodies` (as the new hole) and measure the through depth on the tool's own bodies; fixes the 2,203 mm3 left in the slot and 51 s on the enclosure.
2. The same body-by-body cut for Push (negative) and Revolve Subtract, Sweep Subtract, Helical Subtract, Hole to slot, Cut by Path/Thread: they share the whole-model `_combine(..., fuse=False)`.
3. Join tools (Boss, primitives, Mirror, arrays, Loft, Sweep Add, Revolve Add): fuse into the reachable bodies one at a time (the join of bodies the tool does not reach is never needed), so they run on the enclosure at all and do not lose material.
4. Pull with Other bodies: fuse the crossed bodies into the pulled one (or cut them out of the prism) so no material is held twice.
5. Whole-model merge after tools that only changed some bodies: pass `changed=` (or use `finish_scoped`) in new-body primitives (5.6 s each, six tools), Unify (5.9 s), Body boolean (6.2 s), Stretch (6.7 s), Helical sweep (5.4 s), Loft, Mirror, arrays, Revolve, Sweep, Boss, Slot, Shell, Draft, fillet-type tools in Other bodies mode. Each saves about 5 s per use on the enclosure and keeps the model marked merged for the next move.
6. Whole-model measures inside tools: `_bounds_diagonal(topology.shape)` (Slot, Hole through), whole `_volume` before and after (Revolve, Push/Pull, Stretch), `keep_locked` boxes and volumes of every body when a body is locked.

## Table

Time = `tool_commit` on the enclosure in seconds ("this / others" when the tool has the setting); `err` = the call was refused or failed with the shown message (a refusal at 0.0 s costs nothing but gives no timing); `n/t` = not timed, why. Column marks: Y = lesson used,
N = missed, own = limited to the owner body by narrowing, - = not applicable.

| Tool | Changes bodies | (a) scoped merge | (b) body-by-body cut | (c) placement | (d) no whole-model measures | (e) memo | Enclosure time (s) | Other-body correctness |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| push_pull | yes | own (this) / W unify (others) | N: one boolean on the narrowed shape | - | N: 2-3 volumes of the narrowed shape | generic | 0.7 / 0.9; push 0.8 / 0.7 | pull fuses owner only; push misses overlap (failures) |
| push_pull_surface | yes (surface) | own / W | - | - | - | generic | n/t: needs a surface body | not tested |
| fillet_chamfer | yes | own | - | - | own | generic | 0.8 | one body |
| delete_face | yes | own (defeature) | - | - | volume of the body twice | generic | err: "nothing changed" on a wall face; not timed | one body |
| fill_hole | yes | own | - | - | own | generic | 0.9 | one body |
| resize_hole | yes | own | - | - | own | generic | 0.9 | one body |
| move_hole | yes | own | - | - | own | generic | 1.1 | one body |
| add_hole | yes | Y (`finish_scoped`) | Y (`cut_reachable_bodies`) | - | N: `_bounds_diagonal(topology.shape)` for a through hole | Y (memo from merge) | 0.6 / 7.8 first, 1.5 through (others) | correct (tests) |
| add_counterbore | yes | Y | Y | - | as add_hole | Y | 0.7 | same code as add_hole |
| add_countersink | yes | Y | Y | - | as add_hole | Y | 0.7 | same code as add_hole |
| align_holes | yes | own (hole group) | - | - | own | generic | n/t: needs two real holes | one body |
| distribute_holes | yes | own | - | - | own | generic | n/t: needs three real holes | one body |
| add_boss | yes | N: `finish` W | - (fuse) | - | - | generic | 0.9 / err "Boolean operation failed" | loses material across overlapping bodies (failure) |
| add_slot | yes | N: `finish` W | N: 3 whole `_combine` cuts | - | N: `_bounds_diagonal(topology.shape)` | generic | 0.8 / **51.5** (120 -> 231 bodies) | leaves material in the slot (failure) |
| center_between | yes | own | - | N (moves by copy) | volume of body x4 | generic | err: wrong selection; n/t | one body |
| add_box | new body | N: `finish` W | - | - | - | generic | 5.6 (new body); err "Boolean operation failed" (joined) | joined: loses material on overlap (failure, cylinder) |
| add_cylinder | new body | N | - | - | - | generic | 5.6; joined err | as add_box |
| add_sphere | new body | N | - | - | - | generic | 6.0 | - |
| add_cone | new body | N | - | - | - | generic | 5.6 | - |
| add_torus | new body | N | - | - | - | generic | 5.9 | - |
| add_prism | new body | N | - | - | - | generic | 5.7 | - |
| shell | yes | own | - | - | volumes of the body | generic | 0.85 | one body |
| mirror | yes | N: `finish` W | N: one whole fuse | N (transform copy) | bounds for the handle only | generic | err "Boolean operation failed" | correct on the test model; fails on the enclosure |
| patch_fill | yes | own | - | - | - | generic | err: selection; n/t | one body |
| bridge | yes | own | - | - | - | generic | err: selection; n/t | one body |
| unify | yes | N: `finish` W twice | - | - | - | generic | 5.9 | - |
| draft | yes | own | - | - | volume of body x4 | generic | 0.8 | one body |
| align_face | yes | own | - | - | own | generic | err: faces not parallel; n/t | one body |
| stretch | yes | N: `merge_faces` W | N: fuse/cut of one body at a time inside `stretch` (per solid) | - | whole `_volume` of the result | generic | 6.7 | n/t |
| move_body | yes | Y (`changed_solids`, `merge_settled`) | - | Y (location) | Y | Y (`merge_remembering`) | 0.7 | - |
| scale_body | yes | Y (`finish_scoped`) | - | N (transform copy; needed) | Y | Y | 1.0 | - |
| offset_body | yes | Y (`finish_scoped`) | - | - | Y | Y | 0.8 (0.1 mm; 1 mm refused) | - |
| linear_array | yes | N: `finish` W | N: one whole fuse per copy | - | - | generic | err "Boolean operation failed" (body, hole) | correct on the test model; fails on the enclosure |
| circular_array | yes | N | N | - | - | generic | err "Boolean operation failed" | as linear array |
| concentric_array | yes | N | N | - | - | generic | n/t (as circular array) | as linear array |
| path_array | yes | N | N | - | - | generic | err "Boolean operation failed" after **162 s** | as linear array |
| revolve_face | yes | N: `finish` W | N: one whole `_combine` | - | N: `_volume` of the whole shape twice | generic | err "invalid geometry" (the face and axis chosen); n/t | failures (see above) |
| chamfer_two_distances | yes | own | - | - | - | generic | err: selection; n/t | one body |
| chamfer_distance_angle | yes | own | - | - | - | generic | err: selection; n/t | one body |
| body_boolean | yes | N: `finish` W | chosen bodies only (not the whole model) | - | chosen bodies only | generic | 6.2 union / 5.8 subtract | correct: only the chosen bodies change |
| variable_fillet | yes | own | - | - | - | generic | 0.8 | one body |
| fillet_per_edge | yes | own | - | - | - | generic | err: params; n/t (same engine as fillet) | one body |
| loft_faces | yes | N: `finish` W | N: one whole fuse | - | `_volume` of the loft | generic | 1.2 (faces of two bodies) | not tested (selection) |
| sweep_face | yes | N: `finish` W | N | - | `_volume` of the pipe | generic | err: no path found; n/t | not tested (selection) |
| helical_sweep | yes | N: `finish` W | per solid, `_volume` of each | - | N: `_volume` of every body | generic | 5.4 | not tested |
| thread_hole | yes | own | per solid (own) | - | volume of the body | generic | err: not a round hole (selection); n/t | one body |
| hole_features | yes | own | - | - | - | generic | err: selection; n/t | one body |
| resize_fillet | yes | own | - | - | - | generic | 0.8 | one body |
| resize_chamfer | yes | own | - | - | - | generic | err: selection; n/t | one body |
| cut_plane | yes | N: no finish (own merge) | per solid | - | N: `_bounds_diagonal` + three volumes per body | generic | err: plane misses the body; n/t | per solid: correct by construction |
| round_face | yes | own | - | - | - | generic | 1.3 (0.05 mm) | one body |
| inset_face | yes | own | - | - | - | generic | err: inset larger than face; n/t | one body |
| divide_face | yes | own | - | - | volumes | generic | 1.0 | one body |
| edit_hole | yes | own | - | - | - | generic | err: "pocket or slot" for the face picked; n/t | one body |
| edit_void | yes | own | - | - | - | generic | n/t | one body |
| convert_to_countersink | yes | own | - | - | - | generic | err: as edit_hole; n/t | one body |
| convert_to_counterbore | yes | own | - | - | - | generic | err: as edit_hole; n/t | one body |
| extrude_edge | new surface | N: whole `unify_result` | - | - | - | generic | 0.9 | - |
| hole_to_slot | yes | N: `finish` W (not narrowed to cut) | N: two whole `_combine` cuts | - | - | generic | err: as edit_hole; n/t | same whole-model cut as Slot: expect the Slot failure |

Notes on the cells marked "own": `scope_to_bodies` tools merge and measure the owner body only, so their cost does not grow with the model; the merge result is not marked merged, so
the model's next Move/Rotate does one whole-model merge (the memo carried by the handler keeps unchanged bodies when they come back as the same shapes, which these tools do).

Enclosure check of the Slot with Other bodies without settling the model first: the commit had not finished after 290 s (the 51 s above is after three moves). The volume
oracle on the enclosure (`tool covers 63.6 mm3 of the bodies`) could not be compared for that reason; the five-body test model shows the same
whole-model cut leaving material in the slot. Not run on the enclosure: Revolve, Sweep, Loft and Helical sweep Subtract, Hole to slot, Edit/Convert hole tools (the
picked selections were refused), Align/Distribute holes; their code paths are read in the table.
