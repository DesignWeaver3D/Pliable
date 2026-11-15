# Agent notes: stretch (extrude edge, hole to slot)

## Status
- Extrude edge: done (core tool `extrude_edge`, listed under Edges, with icon and search words). Direction is typed as dx, dy, dz (default up); there is no pick-direction button.
- Hole to slot: done (core tool `hole_to_slot`, a "Slot" section of the Hole Editor for one hole). The direction and length are one move vector (dx, dy, dz) with the form's base/destination pick buttons; only the part across the hole's axis counts. Refuses counterbore and countersink holes (a threaded hole is not recognised as a round hole, so it is refused too). No drag handle.
- Resume point: nothing open.

## Owner hand-checks
- Extrude edge: select an edge, set direction and distance, Apply; the result appears in the Surfaces list.
- Hole Editor on one hole: the new Slot button; pick base and destination points, or type X/Y/Z, and check the preview.
