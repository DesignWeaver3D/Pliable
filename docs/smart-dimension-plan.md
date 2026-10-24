# Smart dimension on many selections (plan, awaiting the owner)

Owner request (2026-10-24): "We need the smart dimension tool do work on as many selections as possible to make constraining much easier. Make a plan and discuss the plan with the author." Nothing here is built. The D key already runs the smart dimension on the current selection (see `behavior.md`).

## What exists today

The smart dimension (`SMART_DIMENSION` in `app/src/sketchconstraints.ts`) picks one existing dimension button for the selection, in this order, and the first that fits wins. Items are curves (entities) and points.

| Selection | Dimension made today |
| --- | --- |
| one line | length |
| two points (no curves) | distance between them |
| one arc | radius |
| one circle | diameter |
| two lines | angle between them |
| one line and one point | point to line distance |
| one ellipse | short radius |
| anything else (one point, point and circle, circle and circle, arc and line, three or more items, a spline) | nothing; the status line says the selection does not fit |

Separate buttons (not part of the smart dimension): horizontal distance, vertical distance (one line or two points), angle to the horizontal axis (one line). The value is created at once with the current measurement and opened for editing (Escape keeps it).

## Proposed table

Principle: the smart dimension should always give the dimension a person would draw by hand for that selection, and the most common one first. Where two are equally common, the pointer position decides after the first press (see open question 1); until the owner decides, the first listed is used.

| Selection | Dimension | Notes |
| --- | --- | --- |
| line | length | exists |
| two points | distance | exists |
| two points, almost aligned in one axis | distance (not horizontal or vertical) | open question 1 |
| arc | radius | exists |
| circle | diameter | exists |
| ellipse | short radius | exists; long radius is not a solver dimension yet |
| two lines, not parallel | angle | exists |
| two lines, parallel | perpendicular distance from one to the other (point to line from an end of the first) | new |
| line and point | point to line distance | exists |
| point and circle | distance from the point to the circle centre | new (distance between two points: the centre is a point) |
| point and arc | distance from the point to the arc centre | new |
| circle and circle | distance between the centres | new |
| circle and arc, arc and arc | distance between the centres | new |
| line and circle (or arc) | distance from the circle centre to the line | new (point to line from the centre) |
| line and line and nothing else, sharing an end | angle | exists |
| circle and a point on the same centre | nothing useful: the point is already the centre | message |
| three or more points | a chain of distances, one per neighbour pair in selection order | new, open question 2 |
| line and two points | length of the line is not asked for; distance between the two points | new |
| many lines | one length each, then edit them in turn | new, open question 2 |
| many circles | one diameter each | new |
| several circles and arcs | one radius or diameter each | new |
| a closed shape selected as a whole (rectangle, polygon, slot) | its overall width and height (rectangle), otherwise one length per side | new, open question 3 |
| spline | none: splines have no dimension in the solver | message |
| point alone | none | message |
| a point on a curve and that curve | none (already constrained) | message |

## Rules that apply to every row

- A dimension that would be redundant or conflicts with the existing constraints is refused with the same message the buttons give, and nothing changes (one undo step otherwise).
- Selecting several items of one kind makes one dimension per item (one undo step), each opened for editing in turn with Tab, as for the horizontal and vertical buttons.
- The dimension is placed outside closed faces like today.
- A reference (driven) dimension is made instead when the geometry is already fully constrained, so the key never fails only because the sketch is complete (open question 4).

## Open questions for the owner

1. Two points or a line can be measured as a length, a horizontal distance or a vertical distance. Should the smart dimension choose by where the pointer is after pressing (like most programs), by the angle (near horizontal or vertical gives that axis distance), or always give the length and leave horizontal and vertical to their buttons as now?
2. For three or more points or lines, one dimension per item, all at once, or only the first pair until the owner presses again?
3. For a rectangle or polygon selected as a whole, is overall width and height the wanted result, or one dimension per side?
4. When the sketch is fully constrained already, make a reference dimension instead of refusing?
5. Should the angle between two lines pick the inside or the outside angle, and how is the supplement chosen (as the pointer sits between the lines)?
6. Should the D key keep working when nothing fits, by starting a pick mode (click items one by one until a dimension fits), like a tool that stays active?

## Order of work after approval

1. Pure table in a new `sketchsmartdim.ts` (selection in, dimension descriptions out) with tests for every row above.
2. Wire the Dimension button and the D key to it; keep the existing buttons unchanged.
3. Ask-for-edit chaining (Tab) for multi-item results.
4. Update `behavior.md` and the hand-test list.
