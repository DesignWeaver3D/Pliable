# Surface bodies agent notes

Status
- Step 1 (core), step 4 (import note): done in the first commit. A surface body is a shell outside any solid; `ops.solids_of` returns it as a body (`ops.is_surface` tells it from a solid), so ids, per-body display, scoped merge, delete, duplicate and rename follow with no special case. Auto name "Surface N" (`bodies.SURFACE_KIND`); mesh body rows carry `surface: true`.
- Enclosure (perf/surf_enclosure.py): 120 bodies, 6 of them surfaces, `body_ranges` is not None (no fall back), import time unchanged (16 s, nothing added). A move of a surface body 9 s, of a solid 13 s (the slowness is the existing many-body path, perf-core's work).
- Step 2 (app section) and step 3 (tools list): see below when done.

Tools on a surface body (run through Tool.execute with default params, tests/test_surface_bodies.py covers the first four)
- Work: move_body (Move/Rotate), scale_body, offset_body, unify; also rename, duplicate, delete, lock, hide.
- Work on a face or edge of it, kernel result unchecked by eye: push_pull, add_hole/counterbore/countersink/slot, divide_face, draft, inset_face, round_face, stretch, fillet_chamfer, fillet_per_edge, variable_fillet.
- Refuse with the usual message: shell, delete_face (defeature), mirror, the arrays (boolean failed), add_boss, body_boolean, cut_plane, loft/sweep/revolve, hole edit tools, patch_fill.
- No tool crashed (only OperationError).
