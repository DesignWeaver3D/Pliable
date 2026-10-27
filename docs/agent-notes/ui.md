# ui agent notes (temporary)

## Task 1 Push/pull tilt
- Typed tilt keeps the other arc (tan model: direction = normal + tan(a)*side1 + tan(b)*side2); sign follows the pulled way at the first typed key.
- Arrow is 2.5 handle lengths (PUSH_PULL_ARM_RATIO), pick icon at the arc crossing (1.5 lengths).
- Owner hand-check: tilt each arc by mouse then type on the other; arrowhead grabbable above the target.

## Task 2 Eyedropper
- Icon-only eyedropper (24px) placed just left of the value box; labels nowrap with ellipsis; sizes list also sits before the value box. Hand-check: card rows align in the hole and fillet cards.

## Task 3 Cut with plane card
- Default Remove side None (core default 0; golden registry regenerated). Pick plane first and centred, XY/XZ/YZ row below; Axis row hidden (typing nx/ny/nz sets axis 3); nx/ny/nz kept with tooltips (not redundant: typed directions). Same layout applies to Split with plane (shares the form). Dark select styling now applies to all toolform lists.
- Hand-check: the list popup colours in Chrome.

## Task 4 Linear array
- Card order: Columns (count), Column spacing (dx), Column Z-offset (dz), Rows, Row spacing (dy2), Row Z-offset (dz2), Column Y planar shift (dy), Row X planar shift (dx2). Decision: the model allows one shift per direction (dy for each column step, dx2 for each row step), so both are shown.
- Gizmos: spacing arrows on the second instance; Z arrows above the second instance's top; Y/X shift arrows out of its side; the count cube stays for Columns/Rows.
- Hand-check: arrow placement on a real model (up arrows overlap the spacing arrow if offsets are zero).
- Gap list for "every card parameter has a gizmo" (probe with no selection, so tools needing a selection read as NO_HANDLES and may be wrong; check these with a selection): pattern_hole, pattern_hole_circular, add_hole/counterbore/countersink/slot/boss params (task 7/8 cover hole/slot), path_array count, mirror offset, stretch, shell thickness, offset_body distance, chamfer_distance_angle, resize_hole/fillet/chamfer, revolve_face angle, circular_array axis/axis_edge (choice params), cut/split plane nx,ny,nz and remove_side (choice).

## Task 5 Circular array
- Pie slice (Handle pie=True, piegizmo.ts, drawn in manipulator.ts): arc from the source to the angle (0..angle, at 360 a full circle), grip on the arc, value label on the arc (double-click to type). Count is a badge over the source (Handle badge=True): wheel +/-1, double-click to type. Decision: the old "Copies" arrow grip on the first copy was removed (the badge replaces it). Count 1 is valid (source alone); angle above 360 is refused; default count 2.
- Click on empty space now applies an open array (no Apply/Discard question; picking another tool while an array is open still asks). behavior.md line updated. Other tool cards already applied on empty clicks.
- Hand-check: dragging the pie grip round with a real mouse past 180 degrees to 360; double-click typing.
- Checked in Chrome: pie at 120 deg, count badge wheel.
