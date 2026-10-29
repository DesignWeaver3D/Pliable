# Sketch flip agent notes

Status: done (core function and tests, Flip button, undo, camera, persistence through the sketch's own plane).

Decisions
- Flip keeps xdir, reverses the normal, negates every v, swaps arc and elliptical-arc ends, negates the v of dimension `place`. To change: sketch/flip.py.
- Implemented once in the core (`sketch_flip` request); the card calls it. Button sits in the icon row after Look at; hidden for unrolled (curved face) sketches.
- Undo/redo of a flip refresh the picking plane, grid and gizmos (`syncPlane`); the camera turns only on Flip, not on undo.
- No node test: the frontend part is a thin call to the core; the logic is pytest-covered.

Hand-check (a test cannot decide)
- Flip on a face sketch with drawn geometry looks unchanged in space; Finish keeps it and extruding goes toward the new normal; reopening the kept sketch shows the flipped side.

Candidate behavior.md lines
- When Flip is pressed in a sketch, the plane's normal reverses, the drawing stays where it is in space, the view turns to look from the new side, and it is one sketch undo step.

Resume: nothing open.
