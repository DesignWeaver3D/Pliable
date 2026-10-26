# Arc fillet and chamfer agent notes

Built: Fillet and Chamfer for line+arc, arc+arc and circles (app/src/sketchcornercurves.ts, wired in sketchcorner.ts and sketch.ts). Decisions are in docs/decisions-log.md; behavior line in docs/behavior.md.

Limits, with reasons:
- Chamfer of curves that do not meet is refused: there is no corner to measure the distance from.
- A fillet whose arc would sweep more than 180 degrees (possible between two arcs) is not produced; the shorter arc between the tangent points is always used.
- The Round corner / Bevel corner buttons in the constraint card still handle two lines only (not asked to change).

Human-only checks: real-mouse picking of two curves (first click highlighted, second click side) and the feel of choosing the side with the second click.
