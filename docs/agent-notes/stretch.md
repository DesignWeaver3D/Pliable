# Stretch agent notes

## Sketch solver scenario tests (done)
- core/tests/test_sketch_scenarios.py: rectangle (fully and partly dimensioned), slot (fully dimensioned and free length), tangent chain, symmetric profile (two variants), ellipse in a rectangle (fully and free height), spline through points. Each solves, drags a point in steps, checks no point moved more than twice the pointer move (no flip) and the constraints hold.
- No flips and no solver failures found. Observation, not a bug: a drag on a fully dimensioned profile (rectangle, slot, inscribed ellipse centre) is refused with status failed and no points, so the sketch stays as it was.

## Blind-hole depth grip (no change needed)
- Edit hole already has a "depth" grip (core/src/pliable/tools/edit_hole.py, Handle "depth", resize kind, plus an entry-end "start" grip); the Hole Editor drives edit_hole for existing holes (HOLE_EDITOR_HELPERS in app/src/layout.ts). decisions-log 2026-10-19 records both grips.
- Owner may want to look by hand: whether the Hole Editor shows a depth grip while placing a NEW hole (add_hole.py, off limits for this run, has no Handle).
