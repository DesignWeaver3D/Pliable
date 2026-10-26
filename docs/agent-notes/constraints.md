# Constraints agent notes

## Symmetric
- Cause: the solver library's symmetric-about-a-line constraint ignores the line inside a workplane and always mirrors about the horizontal axis. Now built from "segment square to the line" plus "middle on the line" (core/src/pliable/sketch/symmetry.py).
- The ellipse "Dropped ... it repeats or conflicts" message came from the same wrong constraint (a vertical-axis symmetry clashed with the horizontal one). A truly redundant symmetry (ellipse already centred on the axis and square to it) is still dropped, with the existing wording.
- Sym mark: now drawn at each mirrored point (and at the centre point for symmetric about a point), not at the average with the axis.
