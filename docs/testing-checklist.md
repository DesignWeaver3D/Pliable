# Hand-test queue

Things built and unit tested that the owner has not yet tried in the app. Sessions append one line per thing to check: what to do and what you should see. Delete a line when it passes. If it fails, describe the problem and it becomes a row in [progress.md](progress.md); nothing is marked or kept once it works. Approved behavior is recorded in [behavior.md](behavior.md) when you approve it, so a passed test does not need to be re-run later.

Restart the core before testing anything in the first group.

## Needs a restarted core (new this round)

- [ ] Desktop app (Windows archive): window icon shows, window resizes cleanly; a download (export) works in the webview. macOS and Linux archives untested.
- [ ] Selection clears after applying a constraint. Construction curves are dashed and drawn below normal ones, projected edges included.
- [ ] New ellipse has two construction axis lines you can dimension alone. Centre rectangle has a centre point held symmetric; clicking the centre on a line, axis or point also adds Coincident. Automatic constraints are on by default.
- [ ] Project edges: sphere, cylinder, slot onto a flat plane give true circles and arcs selectable by radius; onto a tilted plane give ellipses (tilted arcs are splines).
- [ ] Zoom all in a sketch fits the sketch with no minimum. Menu > New Project after projecting edges in an open sketch leaves nothing behind.
- [ ] Resize chamfer shows two arrows (which neighbour is "first" is not labelled).
- [ ] Face Draft: Pick axis, then click an edge of its own face or another edge; Axis list switches to Picked point and the face pivots about the plane through that edge. Default axis is Face centroid.
- [ ] If the view goes blank again, the status line names the failing part.
- [ ] Material per body: save/open (.plbl) keeps the material; the 3D look still uses the default for all bodies. (Checked in the browser: Default material is PLA, right-click Material list, steel changes the mass, other bodies stay PLA, undo/redo and Duplicate keep it.)
- [ ] Move/Rotate on straight edges: two arrows square to the edge and one arc; the arc turns the arrows and snaps to adjacent face normals (or type degrees); arrows move the edge with corners sliding along faces that stay put. Check slanted and chamfer edges and preview speed.
- [ ] Move sketches: pick a sketch (row or tinted region), Move/Rotate opens with arrows, rings and fields; curves follow live, Apply is one undo step, Esc puts it back. Open: several sketches at once; fixed projected edges inside a moved sketch.
- [ ] Symmetric: one line about another line or axis, and two circles, arcs or ellipses about a line, axis or point offer Symmetric. If your case does not, note what you selected.
- [ ] Ellipse: older ellipses (made before this change) still take a point on them; snapping a line end onto an ellipse.
- [ ] Project menu: New Project (empty, "Untitled", camera on the origin; it asks for confirmation when there is unsaved work, which blocks browser automation) and choosing the first sample (bracket) at once from "Choose a sample...". (Checked: the menu lists New Project, Open Project, Save Project, Open STEP as New Project, Import STEP, Export STEP, Export mesh, sample list shows "Choose a sample...", no Model info button.)
- [ ] Boolean: offered for faces on two bodies (a body plus faces of another works); first selected is the target. (Checked: two bodies offer it, Union/Subtract/Intersect list.)
- [ ] Sketch batch: three far-apart points offer Symmetric about the third; smart dimension accepts projected edges with other geometry or a point; a value too wide for its arrows goes past the far extension line; two quick taps on a dimension open the editor even after a rebuild; shape and dimensions update first, point colours follow. Long decimals on a diameter or radius leader stay upright.
- [ ] Concentric or nested circles and arcs offer the gap between their rims; clicking a dimension's leader selects it.
- [ ] Round dimensions: circle defaults to diameter (typed entry too), arc to radius; right-click a value to show the other; two circles or arcs offer "Gap between the rims" (not when overlapping); Delete removes a clicked dimension.
- [ ] Smart dimension and region pick: Shift/Ctrl picks several tinted regions.
- [ ] Sketch and selection: 3D box select with no filter takes faces, edges and vertices together (F, E, V restrict); in a sketch, top-bar Undo/Redo and Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z step through sketch edits (tell me any constraint that cannot be undone); a dropped constraint names itself and what it repeats or conflicts with; Shift/Ctrl+click a second tinted region adds it so two circles pull together.
- [ ] Sketch batch two: Symmetric on the strip takes two points about a line, three points about the third, two lines about a line or point; sketch axes can be picked (only when nothing else is near; orange when picked) and dimensioned or constrained to; every dimension value is drawn upright.

## Sketch checks (no restart needed unless noted)

- [ ] Sketch origin: points, the origin among them, draw over every curve; a reopened kept sketch gets its origin back if it had none.
- [ ] Prism icon: Add prism shows a square pyramid.
- [ ] Typed sizes while drawing: the shape previews at the typed sizes with real dimensions showing the typed value (rectangle, line, slot, circle, polygon, ellipse, arc angle); the number being typed has a caret and is orange. Dimension text steps away from the pointer when close.
- [ ] Sketch list and view: hovering a row, its curves or region lights it white; double-clicking curves or a region selects the whole sketch (Delete removes it); a region over a coplanar face wins hover and press. Watch for lag with very large sketches. (Checked: picked sketch is orange, double-click row opens it, rename and Delete are in the right-click menu.)
- [ ] Angle dimension as an arc: arrowheads at both ends, extension lines out to it, value on the middle (beside it when short); dragging the value moves the arc's size and sector; a new angle takes the sector the pointer was in when the tool or D was invoked.
- [ ] Sketch dimensions: card has no constraint buttons; strip never greys buttons; entry on creation applies; dimensions drag by text or lines and new ones go outside closed faces; circle centre selectable under a diameter or radius dimension (leader placement inside a larger face untested); double-click edits any dimension; new dimension appears at once with the value prefilled; horizontal and vertical on several lines; coincident for several vertices and vertex-on-edge; smart tangent or collinear; faces tint as soon as a profile closes; coloured axis edges on the XY, XZ, YZ buttons; dragging a dimensioned horizontal line is free; gizmo off by default; constraint row on its own second row (applying from it untested).
- [ ] Sketch drawing: Tab-typed sizes for rectangle, slot, ellipse, arc, line, circle, polygons; every drawing tool but Line returns to Select after its first shape (spline after closing or Enter; point after one point).
- [ ] Sketch zoom to fit: nav cube fit-everything and fit-selection use the edited sketch's geometry; fit-selection enables with a sketch selection. Checked in the v0.4.0 portable build (Chrome tab, 1555 px wide): fit-selection is disabled with nothing selected (good), but fit-everything in a sketch with about ten shapes left the content filling only about a third of the view width, centred near the origin, and there was a stray point near the far left; fit-selection with a selection not verified.
- [ ] Delete on selected sketch vertices: a lone free end is deleted with its line (the shared-vertex case was checked: status says the coincidence is removed and the lines stay).
- [ ] Constraint list: shared end points appear as automatic Coincident rows (x splits them); list is filtered by the selection.
- [ ] Dimension value gaps: only the dimension's own lines are cut around its value. Check length, diameter and radius leaders, angle tags, point to line, outside-arrow mode, a measured edge length and a hole diameter in 3D, and a value over a tinted face or the grid.
- [ ] Point drag: snaps to the grid (when on), the axes and lines of other points with guides, never joins another point; Horizontal and Vertical on a single line add their constraint.
- [ ] Editing a diameter after a redundant-constraint error does not crash the core; if it does, note the core console output.
- [ ] Implied faces: click a tinted region of a divided rectangle, then push/pull; sketch extrude or revolve with a divider or attached lines. Restart the core first.
- [ ] Outside dimension arrows: pull a length dimension's value past an extension line; arrows are correct with no line between the extension lines.
- [ ] A region next to an extruded region can be picked (restart the core first).
- [ ] Smart dimension (D or the Dimension button, first in the row): cursor menu when several fit (two points: distance, horizontal, vertical); parallel lines distance; centre distances; 3+ items symmetric, midpoint, equal, collinear, concentric; message when nothing fits; a redundant dimension is added as reference with a warning; the constraint list's icon button and right-click on a value switch reference and driving; dragging an angle value across the lines gives the outside angle; polygons get major and minor construction circles. Restart the core first.
- [ ] Zoom to fit leaves nothing behind the top strip, in the model and in a sketch with dimensions (right and left overlays are not excluded).
- [ ] Point to line dimension: the dimension line runs square to the line, extension lines along the line; check by dragging and editing.
- [ ] Sketch planes and regions: faces from areas enclosed without shared end points (divider across a rectangle, lines attached to a side); offset and angled planes from a flat face; plane tangent to a face at a vertex; clicking a kept sketch's tinted region adds it as a selected face (push/pull, pocket, Revolve face, Sweep, Loft) and clicking one opens its extrude dialog; grid has no jiggle during a camera glide.

## Modeling and selection checks

- [ ] One push/pull path: dragging the face's arrow handle behaves like dragging the face (M or right-click measure edges, typed value, Shift symmetric, companion faces); both start points give the same result and the arrow keeps tracking.
- [ ] Sketch region pull undo: pick a kept sketch's region, pull it, Undo once returns to before the pick (no loose face) and Redo brings the extrusion back.
- [ ] Delete key in lists: right-click Delete on datum rows and on a multi-selected body row works, and one Undo brings them back. (Sketch rows checked: Delete then one Undo brings it back.)
- [ ] Add prism: top and bottom diameter handles and the sides cube grip riding the top rim (needs a real mouse). (Checked: form applies, a top of 0 gives a true pyramid with 7 faces, Edit primitive is in the bodies list menu, searching hexagon or polygon finds it.)
- [ ] Push/pull direction: pick icon past the arrow head with two coloured arcs about the face's sketch axes; pick then click a straight edge (or a face for its normal) sets the direction and keeps Push/Pull active; drag an arc to lean the arrow, angle label only while tilted. Untested: arrow-handle drag along a tilted direction, dragging the arcs with the real mouse, a slanted edge pick, the loose sketch face path. Shift (symmetric) with a tilted direction should show an error. Possible hang: while testing with scripted pointer events I dragged the direction arc (arrow tilted, label '30° off the face normal'), pressed Escape, then clicked Menu, and the Chrome tab froze and had to be closed (the core kept running). Probably my test method, but please try Escape and then Menu after tilting the arrow by hand.
- [ ] Typed entry on the direction arcs and the array cube grip: hold an arc and type degrees (Enter applies, Escape cancels); hold the cube grip and type columns, Tab, rows, Enter. Test with a real held mouse button.
- [ ] Linear array grid: 3 by 3 default, two spacing grips and a cube corner grip; dragging the corner in the plane of the two steps sets columns and rows independently; rows 1 gives the old line; with parallel steps the corner stays an arrow along the diagonal. Spacing grips untested.
- [ ] Array apply or discard: with an array form open, clicking away, editing a primitive or picking another tool asks Apply or Discard. Apply and the edit-primitive path untested.
- [ ] Selection and UI: box-drag filters F, E, V with badge; Select similar; Select parent bodies (wording provisional); edge centres as snap points; bodies list scrolls to the picked body; hints stay until Got it; search keywords, recents, searchable settings, Getting started card, printable shortcut sheet; touch sizing (needs a real touch device).
- [ ] Modeling: Cut with plane (any direction, keep both halves); counterbore and countersink at either or both ends; Shift toggles symmetric push/pull mid-drag; primitive handles (stems point inward, only the cube or arrowhead grabs); Model info for the selected body; datum planes; Mirror mode; symmetric push/pull about a sketch plane, mid-plane or datum; save and open `.plbl`; refresh resumes the open model before any crash prompt; rotation gizmos are 50% of the viewport.
- [ ] Opening the block model while a 109-solid STEP is loaded takes seconds, not 150 s (restarted core).
- [ ] Earlier unchecked: snapping to a ghosted body's edge, Normal-to-edge sketch plane, rotation rings typed degrees, Material choices other than ABS, gloss on a 100k-triangle model, Mirror, Rotate and Scale prompts, circle of copies, split, three-point arc and circle previews, plane through points, kept curve drawing over the model, renaming and deleting a kept sketch, typed negative sign.

## Not yet tried (from the first checklist, 2026-10-18)

- [ ] Restore prompt: kill the core, restart it, the previous model is offered once; two copies running at once never offer or touch each other's session
- [ ] Sharp-edge angle slider (settings) changes what Sharp edges selects. (Checked: with one edge selected, Edge loops, Edge ring and Sharp edges each select and highlight a result.)
- [ ] Inset face edges: outer loop and loop 1 on a face with holes (face count goes up). Checked in the portable build in Chrome: outer loop (distance 2) on the bracket's top face raised the count 65 to 68 faces. Loop 1 (applied to the new inner face) went 68 to 70 faces but the Bodies list went from 4 to 6 (new Body 2 and Body 3 appeared); one Undo restored it. My test model had an overlapping duplicate body, so please re-check loop 1 on a plain bracket.
- [ ] Divide face: placing the divide edge by dragging in the view. (Typed form checked: Apply raised the count 68 to 70 faces.)
- [ ] Fillet per edge on all top-face edges: 0 open edges after applying
- [ ] Rotate body, Scale body and Offset body act on the selected body only; a group of faces from two bodies moves both; nothing selected moves everything. (Checked: Add box makes its own body, Move on one selected body moves only that body.)
- [ ] Emboss/Cut along surface on a cylinder face and on a wrapped sketch region; unrolled sketch plane sits beside the model
- [ ] Unrolled sketch: cone (not a pointed cone), a chain of flat, fillet and flat faces, a region across the seam of a closed cylinder
- [ ] Sketch: a free line and circle drag by their body without anything else moving; tangent arc and line; snap to an in-plane axis line
- [ ] Hole centre dots: they show on every hole all the time (known); dragging one moves the hole
- [ ] Per-tool applies-to chip: Resize hole also resizes same-size holes by default, other tools only the selected feature
- [ ] Unsaved-work warning when leaving the page with an open sketch and nothing else changed. (Leaving with model edits was checked: the browser asked first.)
- [ ] Packaged build: unzip, run, open the bracket, push/pull, export STEP (or confirm CI is green)
- [ ] A long open shows the busy indicator and the UI stays responsive; it clears after a failed operation too
- [ ] Sketch card: with a long constraint list (draw a few rectangles), the rows scroll inside the card; Finish sketch, Check sketch and the other buttons stay in place.
- [ ] Sketch list, datum plane list and constraint list rows use a trash can button to delete (the X only means see-through).
- [ ] Open a tool form (for example Add box), then Menu > New project: no tool selection error appears in the status line or the diagnostics report.
- [ ] Sketch: put Fix, Equal or other constraint marks on circles and arcs; the tag sits just above the centre point instead of covering it, and the selected centre highlight stays visible.
- [ ] Sketch: a larger fully constrained sketch (several dimensioned rectangles) shows all its geometry in the fully constrained colour; a circle whose radius has no dimension is a known exception (still coloured when only its centre is placed).
