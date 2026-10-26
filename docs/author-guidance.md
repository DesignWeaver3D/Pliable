# Author guidance

The only list that asks for the owner's time. It holds what tests and the decision hierarchy cannot settle: things a person must see or feel, real choices, and anything that would override an approved entry in [behavior.md](behavior.md).

Rules for keeping it:

- Sorted by priority, then grouped by tool or workflow within each priority, so related checks are done in one sitting. When adding an item, put it in its group and re-sort; never append at the end.
- Priorities: **High** (possible bugs, data loss or workflow-breaking behavior), **Normal**, **Future** (long-term choices, no work waiting on them).
- Not listed here: any default that follows the decision hierarchy (see the project instructions file, "Deciding without the owner") and has passing tests. Those are finished; the reason is one line in [decisions-log.md](decisions-log.md) or the commit message. Problems found later come back as bugs or GitHub issues.
- Each item says what to do and see (or the question), and the default that stands if unanswered. A passed or answered item is deleted; git keeps the history. An approved behavior goes into behavior.md in the same commit.

## High priority

### Possible hangs, blank views and data loss


### Desktop app (Windows archive)


## Normal priority

### Gizmos and handles that need a real mouse (hold the button down)

- [ ] Inset face edges with a distance past the first overlap: drag the distance handle and watch the merged preview (the result itself is tested).
- [ ] Push/pull: dragging the face arrow handle behaves like dragging the face (M or right-click edge measure, typed value, Shift symmetric); the arrow keeps tracking after a drag along a tilted direction; direction arcs lean the arrow with the angle label only while tilted; a slanted edge pick sets the direction.
- [ ] Typed entry on a gizmo: hold a direction arc and type degrees (Enter applies, Escape cancels); hold the array cube grip and type columns, Tab, rows, Enter.
- [ ] Arrays: linear grid grips (two spacing grips and a cube corner grip), circular array arc and count grips, Apply or Discard prompt when clicking away from an open array form.
- [ ] Move/Rotate on straight edges (two arrows square to the edge and one arc that snaps to face normals; slanted and chamfer edges; preview speed), on sketches (rows or tinted regions; several sketches at once), and Move hole/boss arrows.
- [ ] Round face edges, Divide face (edge grip, angle, grid), Resize chamfer two arrows (which neighbour is first is not labelled), Add prism handles (top and bottom diameter, sides cube riding the top rim).
- [ ] Touch sizing on a real touch device.

### Sketch: drawing and dimensions (look and feel)

- [ ] Typed sizes while drawing: the shape previews at the typed sizes, the typed number has a caret and is orange, dimension text steps away from the pointer.
- [ ] Dimension drawing: angle dimension as an arc, outside arrows past an extension line, point-to-line dimension, value gaps cut only the dimension's own lines (length, diameter, radius, angle tags, over a tinted face or the grid), long decimals on a leader stay upright, dragging a dimension by its text or lines.
- [ ] Dimension and constraint marks: tags sit above arc and circle centres so a selected centre stays visible; the arc radius leader points at the arc and drags freely, with a dashed extension past an end point; the click-to-light degrees-of-freedom message in yellow.
- [ ] Sketch list and views: hovering a row, curves or a region lights it white; double-click selects the whole sketch; watch for lag with a very large sketch; construction curves dashed and under normal ones; sketch origin drawn over every curve.
- [ ] Fully constrained colouring on a larger dimensioned sketch (a circle with only its centre placed is a known exception).
- [ ] Smart dimension cursor menu (two points: distance, horizontal, vertical; three or more items: symmetric, midpoint, equal, collinear, concentric), and Shift/Ctrl picking several tinted regions.

### Sketch: tools

- [ ] Fillet and Chamfer sketch tools, Trim (piece between a line end and an arc), Split at a point on a line, Rectangle corner styles (Square, Rounded, Bevelled), sketch-only keys C E S H T L R.
- [ ] Symmetric about an axis (line ends above and below the x-axis stay mirrored; Sym marks sit at each point) and Fixed/Lock (a Fixed circle centre cannot be dragged; the degrees of freedom count matches; tooltips say what they do). The ellipse case (top and bottom quadrant points plus the x-axis) is a plan row again. Try your original steps and tell me if it still looks wrong.
- [ ] Ellipse arc tool: the five clicks (centre, long-axis end, short-radius point, start, end), the start and end direction, dragging an end along its ellipse, and Split on an ellipse (the cut point is marked only when hovered).
- [ ] Fillet and Chamfer on a line and an arc, two arcs and a circle: first click a curve, second click the side (real-mouse feel of the two-curve pick).
- [ ] Dimension and Horizontal / vertical drop lists (the small arrow beside each button) and the rule that only a click on empty space applies an open tool, with a real mouse on every tool card and gizmo.
- [ ] Cut with plane: drag the arrow and tilt rings, pick a kept sketch and an origin plane, and the Side 1 / Side 2 colours; Fillet/Chamfer with edges selected: the Two distances chip (which side is first for edges on other faces).
- [ ] .ifc and .3dm in the native file dialogs: export both, open them in another program, import them back (IFC needs the optional IfcOpenShell extra; exports are lossy meshes/facets).
- [ ] New sketch arc tools with a real mouse: Tangent arc, Arc by ends and radius, Start angle and Sweep fields, Circle and Arc tangent to curves; Round / Bevel corner on line-arc and arc-arc corners; Trim and Extend at ellipse and spline crossings (the last three were not clicked in the browser).
- [ ] Sketch parity with a real mouse: Shift/Ctrl+click a kept sketch's curve chooses the sketch; snapping to sketch ends, centres and midpoints; Array along path and Sweep face with a chosen sketch (sweep tested in the core only); the View button starts a sketch square to the camera and the plane stays fixed after orbiting.
- [ ] Newest user constraint wins: a constraint that repeats an automatic one removes the automatic row with a warning naming it.
- [ ] Drag of a free line, circle or point (snaps, guides, nothing else moves).
- [ ] Free circle: dragging its rim resizes it with the centre fixed, dragging its centre moves it; ellipse quadrant vertex rotates it with both construction lines live, and moving an ellipse feels smooth (checked only with synthetic pointer events).

### Model: faces, edges and selection (look and feel)

- [ ] Measure (M) pressed right after pressing a face; measuring after other tools; Ctrl+double-click an edge with faces already selected keeps them; Shift+click shows the hint line.
- [ ] Selection feel: shift-select and the chips (what they are for), hard-to-hit small faces and edges, double-click chains that add non-tangent edges, box select with F, E, V filters and badge.
- [ ] Hole work with a real mouse: Edit hole step depth grips (counterbore and countersink), the Sizes preset list, Edit cut (square and slot: move, resize and depth grips; the slot only has tests), pressing a hole centre dot, push/pull and drag on a hole whose wall is two faces, and the display precision setting in tool forms, labels and drag rounding.
- [ ] Hole centre dots, per-tool applies-to chip (Resize hole also resizes same-size holes by default), Move hole/boss with several holes.
- [ ] Emboss and Cut along surface on a cylinder and a wrapped region; unrolled sketch on a cone, a flat-fillet-flat chain, and across a closed cylinder's seam.
- [ ] Face Draft pivot (Pick axis, then an edge of its own face or another edge), and Cut with plane with its Remove side list and Pick plane.

### Decisions

