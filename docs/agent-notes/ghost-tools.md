# ghost-tools notes

Status: done (all tasks a to e in one commit with its tests).

What changed: `finish(shape, cutters)` records cutting volumes; `Tool.execute` attaches the ghost for any preview with cutters (the push/pull call in `tools/push_pull.py` was removed, same result). Ghost on: helical sweep, revolve face, sweep face (Subtract); Add hole, counterbore, countersink, slot (starting on the face, none for depth 0 = through); Emboss/Cut along surface (gets it through push/pull cutters). No frontend change needed.

Skipped: Boolean subtract (the tool body is itself a body, so tool minus bodies is empty), Cut with plane, fillets/chamfers, shell, draft, fill hole, move/resize hole (no tool volume in empty space).

Decisions: through holes/slots show no ghost; overlapping cutters (up to 3) are cut in sequence, more are cut together as disjoint pieces (a 16-turn coil took 12 s with sequential cuts).

Cost (preview): 100-hole plate, add_hole about +150 ms (op 650 ms); 4-turn coil +150 ms, 16-turn coil +440 ms.

Owner should look at: the ghost of a coil/revolve swinging out of a body, and of a blind hole running past the far face (looks as the push ghost); Emboss/Cut along surface ghost only appears for a cutter leaving the body, which a test cannot judge visually.

behavior.md candidates: "when a subtracting tool's preview volume lies partly outside the bodies, that part is drawn as the red ghost"; "when a hole or slot is through (depth 0), no ghost is drawn"; "when a tool adds material, no ghost is drawn".

Resume point: nothing open.
