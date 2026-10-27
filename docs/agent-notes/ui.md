# ui agent notes (gizmo for every card parameter)

Done (core handles, tests in core/tests/test_card_gizmos.py): Resize fillet (radius grip on the fillet surface), Resize hole/boss (radius and diameter grips), Shell (thickness grip on the first opened face rim), Offset body (arrow on the +X side), Mirror (offset arrow along the plane normal), Chamfer distance and angle (distance grip, angle arc), Revolve face (pie angle), Array along path (count badge at path start), Add hole/counterbore/countersink (diameter, depth, move arrows; recess width, depth, cone angle), Add boss (diameter, height, move arrows), Pattern hole (spacing grip, count badge), Circular pattern (angle pie, count badge), Stretch (three move arrows). Resize chamfer already had both grips.

Decisions (log in decisions-log.md):
- Pure choice parameters get no gizmo: Mirror plane, Revolve mode, Stretch mode, Circular array axis, size-by lists.
- Resize fillet: only cylinder fillets have a grip; end_radius (variable fillet) has none (a variable fillet is free-form, no simple grip).
- Add hole depth 0 = through shows the grip at the far side using the model's bounding box (exact only for prismatic parts).
- Pattern hole circular: axis numbers (px..az) have no grip; the axis stays typed/picked. Mirror picked-plane numbers likewise.
- Add counterbore got grips too (same family as the countersink).

Owner hand-checks (real mouse): drag each new grip once (fillet radius, chamfer angle arc, revolve pie, shell thickness, hole depth) and confirm the live value and preview follow. Checked in Chrome only: Offset body arrow appears.

Still without a gizmo: see decisions above (choices, variable fillet end radius, circular pattern axis point/direction).
