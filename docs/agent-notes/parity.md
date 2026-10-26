# Sketch parity agent notes

Status per task (updated at each commit).

1. Sketch curves selectable and snappable in 3D: done (Shift or Ctrl+click on a curve chooses the sketch; point picks snap to sketch ends, centres, midpoints and curves). Checked in Chrome on port 5202. Not done: choosing single curves (only whole sketches), snapping of the push/pull drag and of face drags to sketch geometry (they have no snap system to extend).

2. Kept sketches as sweep rails and array paths: done in the core (Selection.rail, sketch/rail.py, tests in core/tests/test_sketch_rail.py) and the view (a chosen sketch makes Sweep face and Array along path available). Checked in Chrome: Array along path with a chosen sketch previewed, applied and undone. The sweep was checked by core test only. A path of several joined lines, arcs and splines works as one chain; an open or branching chain that does not join is refused with a message. Linear array was not changed (it is a straight grid).

3. Profile faces of a kept sketch pushed or pulled with the arrow: already built before this run (behavior.md: clicking a kept sketch's tinted region adds it as a temporary face, pulled as one undo step). Checked in Chrome: a closed sketch's region clicked offers Push/Pull with its arrow and the pick drops on a click away. No change made. The Sketch parity row text in progress.md is stale on this point (not edited by this agent).

4. Sketch on the view plane: done (View button in the sketch bar; app/src/viewplane.ts, test viewplane.test.mjs). Checked in Chrome: a line drawn on the view plane lands where clicked on screen. Real-mouse-only check left: orbit after starting and confirm the plane stays fixed.

5. Live (associative) projected edges: not built, on purpose. Face and edge ids are positions in the current topology listing (only bodies have stable ids), so a projected edge cannot be tied to its source edge across a model change without guessing; a wrong guess would give silently stale or wrongly re-bound geometry, which this task forbids. Needs stable sub-shape identity (naming faces and edges through operations) first. The snapshot behavior (behavior.md) is unchanged. The second-solver item was skipped as instructed.

Other limits: chosen sketches are whole sketches, not single curves; push/pull and face drags have no sketch snap. Real-mouse-only checks: Shift+click on a curve in a crowded view (curves near model edges), and the Sweep face along a kept sketch in the form (core-tested only).
