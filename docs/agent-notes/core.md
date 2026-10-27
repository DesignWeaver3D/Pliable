# Core agent notes (temporary; fold into the plan, then delete)

## Status
1 slower 3D: done (Topology.edge_faces iterated a slow OCP list; the Edit cut check took 1.5 s on a 410-face plate, now 0.2 s). Remaining 0.2 s is Edit cut flooding every wall of a perforated plate; related-faces chips cost about 80 ms (face areas, old code).
2 union -> compound body: PARKED. A body is exactly one solid (BodyState is parallel to solids_of; 42 callers, tessellate, measure, recipes). Needs an owner decision on the body model (a body of several solids, one list row, one id). Today a disjoint union leaves two bodies.
3 coplanar chip on several solids: done (chip already found faces on all solids; push/pull refused them as "different solids". Now each solid is pushed on its own).
4 global axes: done (Sel kind "axis", Selection.axes, pickable lines when nothing nearer is hit, Ctrl+click joins a face; Revolve face, circular array's Pick axis edge and Draft's Pick axis accept them).
5 revolve face with a face only: done (form: Axis list X/Y/Z/Picked edge plus Pick axis edge button).
6 sketch region + edge/axis: done for a picked region (pending profile kept when an edge or axis joins; Revolve face works on a loose region face). PARTLY PARKED: whole sketch chosen in the Sketch list plus an edge (no face exists for it; needs a rule for turning a whole sketch into region faces).
7 stretch: could not reproduce on simple solids through the server or Chrome; on parts with curved neighbours it refused. Now a flat end moved straight along its normal falls back to extruding its section.
8 draft pick axis: a click near an edge end picks a vertex, which was refused with only status text. Corner points and global axes now pivot. Could not reproduce a core-side silent failure.
9 emboss on whole round wall: now refuses with an explanation (it only changed the radius, like push/pull). Wrapping a sketch region onto a cylinder directly was not built; the unrolled-sketch patch workflow is unchanged.
10 measure: double-click in measure mode ignored; Shift hint reworded.

## Decisions (add to docs/decisions-log.md)
- Global axes are picked only when no vertex, edge or nearer face is under the pointer; hidden when the axes are hidden.
- Revolve face axis order: selected edge, else selected global axis, else the form's axis.
- Stretch fallback and emboss refusal as above; Shift hint wording "click an item to add it to the selection".
- Accepts gained `axes`; every tool's golden registry entry changed (tool_registry.json regenerated).

## Behavior to add to docs/behavior.md (owner-stated or decided)
- A global axis can be clicked in the view and joined to a face with Ctrl+click; Revolve face then turns the face about it.
- Revolve face needs only a face; the axis can be chosen in its form.

## Owner hand-checks
- Click an X/Y/Z axis line in the view near the model (should highlight; faces and edges still win when nearer).
- Pick a sketch region, Ctrl+click a model edge or axis: the region stays picked; Revolve face runs.
- Press M while dragging push/pull and double-click a candidate: nothing else starts.
- Draft > Pick axis: click near an edge end.

## Watchlist
Entries appended for the multi-solid push/pull and the Stretch fallback.
