# Constraints agent notes

## Symmetric
- Cause: the solver library's symmetric-about-a-line constraint ignores the line inside a workplane and always mirrors about the horizontal axis. Now built from "segment square to the line" plus "middle on the line" (core/src/pliable/sketch/symmetry.py).
- The ellipse "Dropped ... it repeats or conflicts" message came from the same wrong constraint (a vertical-axis symmetry clashed with the horizontal one). A truly redundant symmetry (ellipse already centred on the axis and square to it) is still dropped, with the existing wording.
- Sym mark: now drawn at each mirrored point (and at the centre point for symmetric about a point), not at the average with the axis.

## Fixed and Lock
- Cause: a Fixed (and Lock) point was held by the solver, but a drag overwrote the point's value before noticing it was held, so the point jumped to the pointer. The degrees of freedom count (2 per Fixed point) was already right.
- Green colouring: a circle with a placed centre but free radius was drawn green; the freedom reply now carries `free_sizes` (circles whose radius is free) and those are not green.
- Lock meaning decided and logged (decisions-log.md). Tooltips added in app/src/sketchconstrainthelp.ts.
- Not checked in a real browser drag: the other agent changes circle/ellipse drag code in sketch.ts; the core now ignores any drag target for a Fixed point.
