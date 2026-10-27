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
