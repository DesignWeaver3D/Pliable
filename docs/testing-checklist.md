# Hand-test queue

Things built and unit tested that the owner has not yet tried in the app. Sessions append one line per thing to check: what to do and what you should see. Delete a line when it passes. If it fails, describe the problem and it becomes a row in [progress.md](progress.md); nothing is marked or kept once it works. Approved behavior is recorded in [behavior.md](behavior.md) when you approve it, so a passed test does not need to be re-run later.

Restart the core before testing anything in the first group.

## Needs a restarted core (new this round)

- [ ] Desktop app (Windows archive): window icon shows, window resizes cleanly; a download (export) works in the webview. macOS and Linux archives untested.
- [ ] Trim: first click splits at crossings and turns the clicked piece into construction; second click on it deletes it. Split: two lines sharing an end give no false conflict.
- [ ] Arc by center follows the pointer clockwise and counter-clockwise (a typed sweep stays counter-clockwise). Arc by 3 points: start, end, then through.
- [ ] Selection clears after applying a constraint. Construction curves are dashed and drawn below normal ones, projected edges included.
- [ ] New ellipse has two construction axis lines you can dimension alone. Centre rectangle has a centre point held symmetric; clicking the centre on a line, axis or point also adds Coincident. Automatic constraints are on by default.
- [ ] Project edges: sphere, cylinder, slot onto a flat plane give true circles and arcs selectable by radius; onto a tilted plane give ellipses (tilted arcs are splines).
- [ ] Zoom all in a sketch fits the sketch with no minimum. Menu > New Project after projecting edges in an open sketch leaves nothing behind.
- [ ] Selecting a body shows volume and mass in the measurement card.
- [ ] Resize chamfer shows two arrows (which neighbour is "first" is not labelled).
- [ ] Face Draft: Pick axis, then click an edge of its own face or another edge; Axis list switches to Picked point and the face pivots about the plane through that edge. Default axis is Face centroid.
- [ ] If the view goes blank again, the status line names the failing part.
- [ ] Material per body: Settings > Default material is PLA; right-click a body in the list > Material, pick a metal; with the body selected its mass follows; other bodies keep the default; undo/redo, save/open and Duplicate keep it. The 3D look still uses the default for all bodies.
- [ ] Move/Rotate on straight edges: two arrows square to the edge and one arc; the arc turns the arrows and snaps to adjacent face normals (or type degrees); arrows move the edge with corners sliding along faces that stay put. Check slanted and chamfer edges and preview speed.
- [ ] Move sketches: pick a sketch (row or tinted region), Move/Rotate opens with arrows, rings and fields; curves follow live, Apply is one undo step, Esc puts it back. Open: several sketches at once; fixed projected edges inside a moved sketch.
- [ ] Symmetric: one line about another line or axis, and two circles, arcs or ellipses about a line, axis or point offer Symmetric. If your case does not, note what you selected.
- [ ] Ellipse: four axis-end points plus centre; typed sizes are major and minor widths; Dimension offers Major width and Minor width; a point can be put on an ellipse (Coincident, Point on, snapping a line end) without a TypeError; older ellipses still take a point on them.
- [ ] Project menu: New Project (empty, "Untitled", camera on the origin), Open Project, Save Project, Open STEP as New Project, Import STEP, Export STEP, Export mesh; no Model info button; sample list shows "Choose a sample..." and the first sample (bracket) can be chosen at once.
- [ ] Boolean: offered for two or more bodies, or faces on two bodies (a body plus faces of another works); Union, Subtract, Intersect list; first selected is the target.
- [ ] Sketch batch: three far-apart points offer Symmetric about the third; smart dimension accepts projected edges with other geometry or a point; a value too wide for its arrows goes past the far extension line; two quick taps on a dimension open the editor even after a rebuild; shape and dimensions update first, point colours follow. Long decimals on a diameter or radius leader stay upright.
- [ ] Concentric or nested circles and arcs offer the gap between their rims; clicking a dimension's leader selects it.
- [ ] Round dimensions: circle defaults to diameter (typed entry too), arc to radius; right-click a value to show the other; two circles or arcs offer "Gap between the rims" (not when overlapping); Delete removes a clicked dimension.
- [ ] Smart dimension and region pick: two separated points give the length at once; Horizontal distance and Vertical distance are strip buttons with icons; Shift/Ctrl picks several tinted regions.
- [ ] Sketch and selection: 3D box select with no filter takes faces, edges and vertices together (F, E, V restrict); in a sketch, top-bar Undo/Redo and Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z step through sketch edits (tell me any constraint that cannot be undone); a dropped constraint names itself and what it repeats or conflicts with; Shift/Ctrl+click a second tinted region adds it so two circles pull together.
- [ ] Sketch batch two: Symmetric on the strip takes two points about a line, three points about the third, two lines about a line or point; sketch axes can be picked (only when nothing else is near; orange when picked) and dimensioned or constrained to; every dimension value is drawn upright.

## Sketch checks (no restart needed unless noted)

- [ ] Sketch origin: points, the origin among them, draw over every curve; a reopened kept sketch gets its origin back if it had none.
- [ ] Error messages: every status-line error or warning is recorded (last 50, with time) in Copy diagnostics; clicking a cut-short or error message opens it whole in a window you can copy from.
- [ ] Prism icon: Add prism shows a square pyramid.
- [ ] Repeat last sketch tool: Enter with the Select tool active restarts the last drawing tool; Enter during a line chain still ends it.
- [ ] Typed sizes while drawing: the shape previews at the typed sizes with real dimensions showing the typed value (rectangle, line, slot, circle, polygon, ellipse, arc angle); the number being typed has a caret and is orange. Dimension text steps away from the pointer when close.
- [ ] Sketch list and view: hovering a row, its curves or region lights it white; a picked sketch is orange; double-click a row opens it; rename and Delete are in the row's right-click menu; double-clicking curves or a region selects the whole sketch (Delete removes it); a region over a coplanar face wins hover and press. Watch for lag with very large sketches.
- [ ] Angle dimension as an arc: arrowheads at both ends, extension lines out to it, value on the middle (beside it when short); dragging the value moves the arc's size and sector; a new angle takes the sector the pointer was in when the tool or D was invoked.
- [ ] Sketch dimensions: card has no constraint buttons; strip never greys buttons; entry on creation applies; dimensions drag by text or lines and new ones go outside closed faces; circle centre selectable under a diameter or radius dimension (leader placement inside a larger face untested); double-click edits any dimension; new dimension appears at once with the value prefilled; horizontal and vertical on several lines; coincident for several vertices and vertex-on-edge; smart tangent or collinear; faces tint as soon as a profile closes; coloured axis edges on the XY, XZ, YZ buttons; dragging a dimensioned horizontal line is free; gizmo off by default; constraint row on its own second row (applying from it untested).
- [ ] Sketch drawing: Tab-typed sizes for rectangle, slot, ellipse, arc, line, circle, polygons; every drawing tool but Line returns to Select after its first shape (spline after closing or Enter; point after one point).
- [ ] Sketch zoom to fit: nav cube fit-everything and fit-selection use the edited sketch's geometry; fit-selection enables with a sketch selection.
- [ ] Sketch view button: switches to orthographic and back to the earlier mode when the camera is turned.
- [ ] Delete on selected sketch vertices removes the coincidence and keeps the lines (a lone free end is deleted with its line).
- [ ] Constraint list: shared end points appear as automatic Coincident rows (x splits them); list is filtered by the selection.
- [ ] Dimension value gaps: only the dimension's own lines are cut around its value. Check length, diameter and radius leaders, angle tags, point to line, outside-arrow mode, a measured edge length and a hole diameter in 3D, and a value over a tinted face or the grid.
- [ ] Point drag: snaps to the grid (when on), the axes and lines of other points with guides, never joins another point; Horizontal and Vertical on a single line add their constraint.
- [ ] Editing a diameter after a redundant-constraint error does not crash the core; if it does, note the core console output.
- [ ] Implied faces: click a tinted region of a divided rectangle, then push/pull; sketch extrude or revolve with a divider or attached lines. Restart the core first.
- [ ] Outside dimension arrows: pull a length dimension's value past an extension line; arrows are correct with no line between the extension lines.
- [ ] D hotkey applies the smart dimension to the selection.
- [ ] A region next to an extruded region can be picked (restart the core first).
- [ ] Smart dimension (D or the Dimension button, first in the row): cursor menu when several fit (two points: distance, horizontal, vertical); parallel lines distance; centre distances; 3+ items symmetric, midpoint, equal, collinear, concentric; message when nothing fits; a redundant dimension is added as reference with a warning; the constraint list's icon button and right-click on a value switch reference and driving; dragging an angle value across the lines gives the outside angle; polygons get major and minor construction circles. Restart the core first.
- [ ] Constraint row: Dimension is first; every button shows an icon and its name; the row wraps well at your window width.
- [ ] Zoom to fit leaves nothing behind the top strip, in the model and in a sketch with dimensions (right and left overlays are not excluded).
- [ ] Point to line dimension: the dimension line runs square to the line, extension lines along the line; check by dragging and editing.
- [ ] Sketch planes and regions: faces from areas enclosed without shared end points (divider across a rectangle, lines attached to a side); offset and angled planes from a flat face; plane tangent to a face at a vertex; clicking a kept sketch's tinted region adds it as a selected face (push/pull, pocket, Revolve face, Sweep, Loft) and clicking one opens its extrude dialog; grid has no jiggle during a camera glide.

## Modeling and selection checks

- [ ] One push/pull path: dragging the face's arrow handle behaves like dragging the face (M or right-click measure edges, typed value, Shift symmetric, companion faces); both start points give the same result and the arrow keeps tracking.
- [ ] Sketch region pull undo: pick a kept sketch's region, pull it, Undo once returns to before the pick (no loose face) and Redo brings the extrusion back.
- [ ] Delete key in lists: right-click Delete on sketch and datum rows and on a multi-selected body row works, and one Undo brings them back.
- [ ] Add prism: top and bottom diameter handles (a top of 0 is a true pyramid), sides cube grip rides the top rim; Edit primitive from the bodies list; searching hexagon or polygon finds it. Form and handles, apply and edit.
- [ ] Push/pull direction: pick icon past the arrow head with two coloured arcs about the face's sketch axes; pick then click a straight edge (or a face for its normal) sets the direction and keeps Push/Pull active; drag an arc to lean the arrow, angle label only while tilted. Untested: arrow-handle drag along a tilted direction, dragging the arcs with the real mouse, a slanted edge pick, the loose sketch face path. Shift (symmetric) with a tilted direction should show an error.
- [ ] Typed entry on the direction arcs and the array cube grip: hold an arc and type degrees (Enter applies, Escape cancels); hold the cube grip and type columns, Tab, rows, Enter. Test with a real held mouse button.
- [ ] Linear array grid: 3 by 3 default, two spacing grips and a cube corner grip; dragging the corner in the plane of the two steps sets columns and rows independently; rows 1 gives the old line; with parallel steps the corner stays an arrow along the diagonal. Spacing grips untested.
- [ ] Array apply or discard: with an array form open, clicking away, editing a primitive or picking another tool asks Apply or Discard. Apply and the edit-primitive path untested.
- [ ] Selection and UI: box-drag filters F, E, V with badge; Select similar; Select parent bodies (wording provisional); edge centres as snap points; bodies list scrolls to the picked body; hints stay until Got it; search keywords, recents, searchable settings, Getting started card, printable shortcut sheet; touch sizing (needs a real touch device).
- [ ] Modeling: Cut with plane (any direction, keep both halves); counterbore and countersink at either or both ends; Shift toggles symmetric push/pull mid-drag; primitive handles (stems point inward, only the cube or arrowhead grabs); Model info for the selected body; datum planes; Mirror mode; symmetric push/pull about a sketch plane, mid-plane or datum; save and open `.plbl`; refresh resumes the open model before any crash prompt; rotation gizmos are 50% of the viewport.
- [ ] Opening the block model while a 109-solid STEP is loaded takes seconds, not 150 s (restarted core).
- [ ] Earlier unchecked: snapping to a ghosted body's edge, Normal-to-edge sketch plane, rotation rings typed degrees, Material choices other than ABS, gloss on a 100k-triangle model, Mirror, Rotate and Scale prompts, circle of copies, split, three-point arc and circle previews, plane through points, kept curve drawing over the model, renaming and deleting a kept sketch, typed negative sign.

## Not yet tried (from the first checklist, 2026-10-18)

- [ ] Alpha notice shows on a first launch, not again after I understand and a reload
- [ ] Restore prompt: kill the core, restart it, the previous model is offered once; two copies running at once never offer or touch each other's session
- [ ] Tooltips: every tool in the list, the strip and Ctrl+K says what it does and what it needs; main bar, sketch panel, settings and Keys buttons have tooltips
- [ ] Box select, window (left to right): only items fully inside; crossing (right to left): everything touched; Box selects kind switch in settings
- [ ] Alt+click cycles through the faces under the pointer, with see-through off and on
- [ ] Edge ring, Edge loops and Sharp edges with one edge selected: result highlighted, tooltip explains each; sharp-edge angle slider
- [ ] Inset face edges: outer loop and loop 1 on a face with holes (face count goes up)
- [ ] Divide face: typed form, and placing the divide edge by dragging in the view
- [ ] Fillet per edge on all top-face edges: 0 open edges after applying
- [ ] Add box creates its own body; Move body, Rotate body, Scale body and Offset body act on the selected body only; a group of faces from two bodies moves both; nothing selected moves everything
- [ ] Boolean joins two bodies into one solid
- [ ] Emboss/Cut along surface on a cylinder face and on a wrapped sketch region; unrolled sketch plane sits beside the model
- [ ] Unrolled sketch: cone (not a pointed cone), a chain of flat, fillet and flat faces, a region across the seam of a closed cylinder
- [ ] Sketch: a free line and circle drag by their body without anything else moving; tangent arc and line; snap to an in-plane axis line
- [ ] Hole centre dots: they show on every hole all the time (known); dragging one moves the hole
- [ ] Per-tool applies-to chip: Resize hole also resizes same-size holes by default, other tools only the selected feature
- [ ] Unsaved-work warning when leaving the page with edits or an open sketch
- [ ] Keys window lists the see-through key (X) and the sketch keys; keys act only while the pointer is over the view
- [ ] Packaged build: unzip, run, open the bracket, push/pull, export STEP (or confirm CI is green)
- [ ] A long open shows the busy indicator and the UI stays responsive; it clears after a failed operation too
- [ ] Copy diagnostics shows its text first and contains nothing personal
