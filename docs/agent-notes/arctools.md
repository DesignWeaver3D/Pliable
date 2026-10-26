# arctools agent notes

Branch agent/arctools, worktree C:\dev\pliable-wt\arctools. All six tasks are built and committed, one commit each, tests passing (app 321, core 579).

## Status per task
1. Tangent arc tool (4c9b381): done, Chrome-checked (arc leaves a line tangentially, tangent constraint listed).
2. Arc by ends and radius, card Start angle / Sweep for the centre Arc (ff28868): done, Chrome-checked (radius 60 arc with an R60 dimension; a 270 degree sweep arc).
3. Circle tangent to curves and Arc tangent to curves (3971dad): done, Chrome-checked with a triangle (incircle and a corner arc). Core solver change: a tangent arc end held on a line or round curve by a point-on constraint no longer adds a second touching point (it was redundant and failed). Covered by three new core tests.
4. Round corner / Bevel corner buttons for line-arc and arc-arc corners (4a2db62): done through roundAt, unit-tested; not clicked in Chrome (shares the Fillet and Chamfer code path).
5. Trim and Extend crossings with ellipses, elliptical arcs and splines (e82a564): done, unit-tested; one Chrome pass of Trim on a line through an ellipse looked right but at an oblique view was hard to judge.
6. Older ellipses counted in the degrees of freedom number (95dfcd6): done in the core solver reply, one core test; not Chrome-checked (needs an old file).

## Decisions
All logged in docs/decisions-log.md (arctools agent entries). Behavior one-liners added to docs/behavior.md.

## Real-mouse-only checks for the owner
- Tangent arc: click a line itself (not its end) and check the nearer end is taken; drag the new arc's end point and see it stay tangent.
- Arc by ends and radius: move the third click around the chord and watch the preview switch between the near and far arc on each side.
- Circle tangent to curves with two circles and a line: the nearest-centre choice feels right.
- Round corner / Bevel corner on a line-arc corner (select the corner point, press the button).
- Trim on a line crossing a spline.

## Not done and why
- Tangent arc from the end of an ellipse, circle or spline is refused: the solver has no ellipse or spline tangent constraint.
- Elliptical arc by three points / bounding rectangle (a bullet of the arc tools row, not in this task list) is untouched.
- The page froze twice in Chrome when the dev server reloaded the page with an unsaved sketch (native leave-site prompt); no code issue.
