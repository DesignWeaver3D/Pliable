# Sketch agent notes (branch agent/sketch)

All tasks below are done and committed locally (nothing pushed). No Chrome or in-app check was made for any
task: the coordinator said the browser was not ready. Each was checked by unit tests (core 421, node 157),
tsc and the build only. Not checked in the app: S97 to S106, S112, S113.

- S97 done: a body drag held every coordinate of both ends, which conflicts with a horizontal or length constraint
  on the same line. `_solved` in sketch.py now pins one coordinate at a time and lets go of the last one the
  solver blames. Regression test `test_dimensioned_horizontal_line_drags_by_its_body`.
- S98 done: sketch materials are now transparent so they sort by render order above the translucent axes.
- S99 done: "Horizontal / vertical" (each line the nearer kind), "Horizontal", "Vertical" for 2+ lines.
- S100 done: Coincident joins 3+ points; points plus line/circle/arc become point_on.
- S101 done: one "Tangent / collinear" button replaces the two.
- S102 done: "Dimension" smart button (placed last), new "Angle to horizontal axis" (axis_angle in the solver).
  Angle dimensions now show as a tag.
- S113 + S112 done (one commit): a new dimension is created at once with the measured value and an inline field
  opens at its text; double-clicking number or lines edits any non-reference numeric constraint.
- S103 done: tinted profile faces in the live sketch (extra sketch_profiles request after each solve).
- S104 done: --ui-offwhite token; leaders, extension and dimension lines and arrows use it.
- S105 done: sketch key hint has a close button; hints sit lower.
- S106 done: plane buttons have axis-coloured left and bottom edges (--axis-x/y/z tokens).

Open: the drag fix lets go of one end of a dimensioned line that is not horizontal (it swings about the other
end), which follows the constraints but is not a pure translation. Dimension editing of a reference dimension is
not offered. Decisions are in docs/decisions-log.md, limits in docs/watchlist.md.

Resume point: nothing left on the list (S107 and later were out of scope).
