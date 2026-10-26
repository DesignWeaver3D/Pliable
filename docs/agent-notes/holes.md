# Holes agent notes

## Task 1: hole face push/pull on a split cylinder (done)
- Reproduced in core: a hole cut as two half cylinders (two wall faces) was refused by `find_hole`, had no centre record, and push/pull, move and resize refused its faces ("only partly round"). The box selection came from the missing centre record (no drag direction).
- Fix: `core/src/pliable/splitwalls.py` (`wall_chain`: the faces that close a full turn about one axis, same radius, same range). `find_hole`, `Hole.of`/`Hole.of_selection`, push/pull, array features and the mesh centre records use it. Every part of a split wall carries the same centre record, so a press on either half finds the hole. Test: `core/tests/test_split_holes.py`.
- Not done: split cones (countersink halves) are not joined; measure's Centre rows and the centre-distance dimensions still need a whole cylinder face.
- Real-mouse only: dragging either half of a split hole in the view (the data path is tested; no split model could be loaded in the browser without a file dialog).
