# Sketch parity agent notes

Status per task (updated at each commit).

1. Sketch curves selectable and snappable in 3D: done (Shift or Ctrl+click on a curve chooses the sketch; point picks snap to sketch ends, centres, midpoints and curves). Checked in Chrome on port 5202. Not done: choosing single curves (only whole sketches), snapping of the push/pull drag and of face drags to sketch geometry (they have no snap system to extend).

2. Kept sketches as sweep rails and array paths: done in the core (Selection.rail, sketch/rail.py, tests in core/tests/test_sketch_rail.py) and the view (a chosen sketch makes Sweep face and Array along path available). Checked in Chrome: Array along path with a chosen sketch previewed, applied and undone. The sweep was checked by core test only. A path of several joined lines, arcs and splines works as one chain; an open or branching chain that does not join is refused with a message. Linear array was not changed (it is a straight grid).
