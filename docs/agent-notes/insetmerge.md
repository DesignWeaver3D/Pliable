# Inset face edges: combined outline when offsets overlap

Before: past the first crossing, the outline and every hole region were all used as split tools, so crossing outlines
cut the face into many extra pieces (Bracket lower top face, all edges: 5 new faces at distance 3, 14 at 8, 23 at 20).
Now: the tool is (inset outline) minus (union of grown hole regions); no overlap gives the same faces as before.

Decisions: islands cut off by the bands stay separate faces; pieces under MIN_DISTANCE in area are dropped; when
nothing is left, the existing "The inset is larger than the face" error is raised. An outline that offsets into several
wires is used whole (before only the first wire was).

Checked: core tests (558), npm test, tsc, build; Chrome on 5202/8802: Bracket lower top face, all edges, distance 11
shows the merged outline, faces 19 to 21, one body; undone.

Human-only: look and feel of the merged preview while dragging the distance handle.
