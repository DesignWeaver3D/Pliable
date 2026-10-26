# Holes agent notes

## Task 1: hole face push/pull on a split cylinder (done)
- Reproduced in core: a hole cut as two half cylinders (two wall faces) was refused by `find_hole`, had no centre record, and push/pull, move and resize refused its faces ("only partly round"). The box selection came from the missing centre record (no drag direction).
- Fix: `core/src/pliable/splitwalls.py` (`wall_chain`: the faces that close a full turn about one axis, same radius, same range). `find_hole`, `Hole.of`/`Hole.of_selection`, push/pull, array features and the mesh centre records use it. Every part of a split wall carries the same centre record, so a press on either half finds the hole. Test: `core/tests/test_split_holes.py`.
- Not done: split cones (countersink halves) are not joined; measure's Centre rows and the centre-distance dimensions still need a whole cylinder face.
- Real-mouse only: dragging either half of a split hole in the view (the data path is tested; no split model could be loaded in the browser without a file dialog).

## Task 2: global display precision (done)
- `roundValue` and `showNumber` (app/src/precision.ts) now drive drag rounding (manipulator, viewport, linked values), form fields after drags or picks, handle, point and status labels, and the 2-decimal drag labels. Sketch constraint/angle rounding unchanged on purpose (stored values). Node test added in precision.test.mjs.
- Real-mouse only: set precision 1 and 6 in settings and drag a handle to see the rounding step.

## Task 3: hole centre as a selectable item (done, flag approach)
- A dot press makes a face selection with `centre: true` (viewport.ts `Sel`); the view marks the dot only; tools see the hole's face as before. Chrome check was inconclusive with the Push/Pull handles over the dot.
- Real-mouse only: press a hole's centre dot with no tool armed and confirm the dot lights and the wall does not; hover the dot likewise.
- Not done: conical mouths; the flag is dropped after a tool run rebuilds the selection.

## Task 4a: standard size tables (done)
- `app/src/holesizes.ts`, a Sizes list in the hole forms (metric clearance, tap drill, cap screw counterbore). Checked in Chrome through the change event (the native list popup was not opened).
- Real-mouse only: open the Sizes list and pick an entry.

## Task 4b: step depth grips (done)
- Edit hole params `step_depth` and `end_step_depth` with grips (edit_hole.py); core tests in test_holes.py. Not checked in Chrome (the bracket has no counterbore; the grip uses the same pattern as the depth grip).
- Real-mouse only: drag the step grip on a counterbore.
