# Agent notes: stretch worktree

## Sketch Join (row "Sketch: join connected curves into one")
- Built: `app/src/sketchjoincurves.ts` (pure), `sketchjoin.ts` (button action), a "Join" button in the sketch card beside Toggle construction (shown with 2+ curves selected). Tests: `app/tests/sketchjoin.test.mjs`.
- Joins: collinear lines -> one line; arcs on one circle -> one arc (a circle when they close up); open splines -> one spline through all points. Curves connect by a shared end point or a Coincident constraint. Anything else is refused with a message (mixed kinds, bent lines, other circles, overlapping arcs, gaps, ellipses/circles/projected edges).
- Constraints: lines keep horizontal, vertical, parallel, perpendicular, angle, collinear, point-on, point-line distance, symmetric; arcs keep radius, diameter, equal, point-on; tangent kept when the other curve touches an end that stays. Lengths, midpoint, block, and constraints between the joined curves go. A joint another curve still ends at stays and is held on the joined curve.
- Open questions for the owner: (1) Mixed lines/arcs/splines into a spline is not offered (it would change the shape); default: refused. (2) Spline join changes the curve slightly at the junction (one spline through all points). (3) No key; button only.
- Hand check: select two collinear lines in the app and press Join.
