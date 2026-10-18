# Agent notes: sketch (S30, S27, S33)

## S30 (in progress)
- Done this run: tangent constraint for circles (line/circle/arc) in solver and constraint list; automatic tangent radius snap when drawing a circle; snaps onto curves/midpoints add point_on/midpoint constraints (this also covers constraining to projected edges, which are fixed reference entities).
- Decisions (owner away): auto tangency only for the circle tool; snaps always create constraints (change: drop the `on` handling in `pointFor` in sketch.ts).
