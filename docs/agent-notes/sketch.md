# Agent notes: sketch (S30, S27, S33)

## S30 (in progress)
- Done this run: tangent constraint for circles (line/circle/arc) in solver and constraint list; automatic tangent radius snap when drawing a circle; snaps onto curves/midpoints add point_on/midpoint constraints (this also covers constraining to projected edges, which are fixed reference entities).
- Decisions (owner away): auto tangency only for the circle tool; snaps always create constraints (change: drop the `on` handling in `pointFor` in sketch.ts).

## S27 (in progress, nearly done)
- Done: axes + origin drawn (`app/src/reference.ts`, Axes toggle button in the bar); point picker (origin, axis, face centre, axis-meets-face) used by tool forms through `Tool.placement` + a "Pick point" button (`toolpanel.ts`); sketches get fixed points for origin, axis crossings and face centre. Checked in Chrome (pick origin for Add box; sketch on bracket top).
- Decisions: "plane crossings" read as axis meets the sketch/face plane; axes always visible by default; small additions to `viewport.ts` (`faceUnder`, `meshData`), `features.py` (one `placement` line per primitive), `tools.py`, `index.html` (Axes button).
- Open: snapping to model vertices/edges in the picker; sketch snap to axis lines (only points).

## S33 Unwrap: research note and spike (GO for developable surfaces, stop at cylinders for now)
- Finding: surfaces that unroll without stretching (cylinder, cone, plane chains joined along straight tangent edges) map exactly, so a sketch on the flat strip maps back to the face with true lengths and areas. Spheres, tori and free-form faces cannot unroll without distortion; they need a projection or a chosen distortion and are no-go until the owner says what accuracy is wanted. Several faces at once means unfolding a chain across shared edges (only tangent chains are exact).
- Spike built and tested: `core/src/pliable/unwrap.py` (cylinder face -> flat plane with reference outline; sketch regions -> faces on the cylinder via 2D curves in the surface parameter space, imprinted with the splitter); requests `sketch_plane {unwrap: face}` and `sketch_regions {unwrap: face}`; button "Sketch on unrolled cylinder" when one curved face is selected. Tests in `core/tests/test_unwrap.py` (rectangle and circle keep their true area). Checked in Chrome on the bracket hole.
- Next if continued: cones (sector unroll), tangent face chains, regions across the cylinder seam, pushing/pulling the wrapped faces (emboss/cut along the surface normal) and exact ellipse/helix curves instead of interpolation.
- Decision: spike limited to cylinders; the unrolled sketch hides extrude/revolve (change in `renderPanel`, `sketch.ts`, flag `flat`).

## S30 status at end
- Done in this run: circle tangency, auto tangent radius, snap constraints (constraining to projected edges comes from these plus fixed reference geometry), origin/centre snap points.
- Not done: click-through zone picking and a fast multi-zone pick (box); this touches model picking in `viewport.ts`, owned by the selection group (S26/S35), so it is left for them: cycle through the faces under the pointer on repeated clicks, and use their box select for zones. Automatic tangency for lines/arcs while drawing.
- Open question for the owner: should sketch snaps always add constraints (now yes)?

## Wave 2a
### S30 (Done except the zone picking handed to the selection agent)
- Automatic tangency for lines (end snaps to the touching point on a circle/arc) and arcs (start on a line end, centre square to it). Solver: `_round_tangent` also covers arcs and lines not sharing an end point, and a line whose end already lies on the curve (no duplicate hidden point, which made the solver report a conflict). Checked in Chrome (tangent line to a circle: no conflict).
- Decision: arc tolerance 2 x AUTO_AXIS_DEG; change in `addArc` in sketch.ts. Snaps still add constraints (question 21 unchanged).

### S33 extension (Done: cones, chains, seam; spheres/tori/free-form stay parked)
- `unwrap.py` rewritten around `build_unrolling(topology, face_ids)` -> bands (one per face) with a map from the unrolled plane to each face's surface parameters; sketch regions are clipped per band (copies at -1, 0, +1 turns for closed cylinders and cones so regions across the seam work) and imprinted. Requests `sketch_plane` and `sketch_regions` take `unwrap` as one id or a list; the button is now "Sketch on unrolled faces" (a curved face, or two or more selected faces).
- Tests: cylinder, seam crossing, cone, cone seam, chain of flat + fillet + flat (round piece area exact), non-chain refused.
- Decisions: regions that cross a closed surface's seam become two faces (one per side); outlines are interpolated curves; a chain uses arc length, so folds without tangency also unroll (change: add a tangency check in `_strip_unrolling`). Not checked in Chrome for cones and chains (only unit tests); the cylinder path was checked earlier.
- Open: pushing/pulling wrapped faces along the surface, kept sketches.

### S27 extras (Done)
- Point picker: model vertices and points on model edges (`reference.ts`, uses `viewport.meshData`/`toScreen`/`faceUnder`; no new viewport.ts edits this wave). Sketch snap to axis lines in the sketch plane (`M.axisLines`, `snap` in sketch.ts: one small block before the point-alignment guides). Checked the vertex snap in Chrome; the axis-line snap only type-checked.
- Decision: axis snap adds no constraint (change: create a reference line entity for each in-plane axis in `start`).
- Resume point: nothing half-done. Candidates for later: kept sketches, pushing wrapped faces, circle/line tangency starting a line from a curve.
