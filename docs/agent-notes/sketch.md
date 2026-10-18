# Agent notes: sketch (S30, S27, S33)

## S30 (in progress)
- Done this run: tangent constraint for circles (line/circle/arc) in solver and constraint list; automatic tangent radius snap when drawing a circle; snaps onto curves/midpoints add point_on/midpoint constraints (this also covers constraining to projected edges, which are fixed reference entities).
- Decisions (owner away): auto tangency only for the circle tool; snaps always create constraints (change: drop the `on` handling in `pointFor` in sketch.ts).

## S27 (in progress, nearly done)
- Done: axes + origin drawn (`app/src/reference.ts`, Axes toggle button in the bar); point picker (origin, axis, face centre, axis-meets-face) used by tool forms through `Tool.placement` + a "Pick point" button (`toolpanel.ts`); sketches get fixed points for origin, axis crossings and face centre. Checked in Chrome (pick origin for Add box; sketch on bracket top).
- Decisions: "plane crossings" read as axis meets the sketch/face plane; axes always visible by default; small additions to `viewport.ts` (`faceUnder`, `meshData`), `features.py` (one `placement` line per primitive), `tools.py`, `index.html` (Axes button).
- Open: snapping to model vertices/edges in the picker; sketch snap to axis lines (only points).
