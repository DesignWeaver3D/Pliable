# Sketch tools agent notes

## Trim: piece between an end point and a crossing
- Cause: Trim cut a line from the far end, so with two or more crossings the automatic collinear constraints joined pieces that are not neighbours. The solver fails on that (the constraint repeats the ones between them), so the cut did not take effect. One crossing always worked; the break only shows with two or more.
- Fix: app/src/sketchtrim.ts re-chains the automatic collinear constraints between neighbouring pieces. Tests: app/tests/sketchtrim.test.mjs (neighbour chain) and core/tests/test_sketch.py (a three-piece chain solves).
- Checked in Chrome (port 5203): a line crossed by two verticals, first click on the end piece cut it and marked it, second click deleted it.
- Not reproduced: crossings with ellipses and splines are not found by `crossings` (lines, circles and arcs only); Trim and Extend ignore them. Left alone (behavior change); add a row if wanted.

## Sketch 2D fillet and chamfer
- The Fillet and Chamfer tools for the corner of two lines already existed (commit d6dcf04; size field "Radius"/"Distance" in the sketch card, also Round corner / Bevel corner buttons for a selected corner point). Checked in Chrome: Fillet on a rectangle corner rounded it.
- Line and arc corners: parked, not built. It needs a tangent-circle solve (which of the tangent circles, inside or outside the arc) and trimming the arc end point; worth its own row.
- Human check: Fillet/Chamfer tools on real drawings (author guidance already lists it).
