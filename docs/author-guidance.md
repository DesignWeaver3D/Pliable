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

- [ ] Push/pull card and modes (new): drag a sketch region on a body face outward (adds) and inward (cuts); hold Alt during the drag (New body: the result stays a separate body, mode buttons show it, releasing Alt restores the mode); Flip swaps which direction adds; the red subtract arrow sits opposite the normal arrow; a subtract through empty space shows the red ghost (judge its look: 35% red with outline) and the status line says "Nothing to subtract" when it reaches no body; the card opens on every push/pull drag; typed distance then Apply. Default if unanswered: stays as built.
- [ ] Sketch card Flip (new): on an origin plane (for example XZ) and on a face sketch with geometry drawn, Flip keeps the drawing in place, the view turns to the other side, Undo reverses it; Finish then extruding goes toward the new normal; a kept sketch reopens flipped.
- [ ] Red subtract arrow and ghosts on other tools (new): drag the red arrow of Push/Pull (hover it, drag it; Flip, Escape, a typed value; hovering it lights the normal arrow, not the red one: say if that matters). Look at the red ghost in Helical sweep and Revolve face (Subtract) swinging out of a body, in Add hole, counterbore, countersink and slot (a blind hole running past the far face), and Emboss/Cut along surface; through holes and slots show none. Default if unanswered: stays as built.
- [ ] Push/pull: dragging the face arrow handle behaves like dragging the face (M or right-click edge measure, typed value, Shift symmetric); a slanted edge pick sets the direction.
- [ ] Move/Rotate on slanted and chamfer edges (single straight edges between planar faces pass), on sketches (rows or tinted regions; several sketches at once), and Move hole/boss arrows.
- [ ] Round face edges, Divide face (edge grip, angle, grid).
- [ ] Push/pull tilt: tilt one arc by mouse then type degrees on the other (the first keeps its angle, sign follows the pulled way); the longer arrow keeps its head grabbable above the target at the arc crossing.
- [ ] New card gizmos, drag each once and see the value and preview follow: resize fillet radius, resize hole/boss, shell thickness, offset body arrow, mirror offset, chamfer distance and angle arc, revolve angle pie, path array count, add hole / counterbore / countersink / boss grips (depth 0 = through puts the grip on the far side by bounding box), pattern hole spacing and count, circular pattern angle, stretch arrows.
- [ ] Linear array: the Columns / Rows card order and the arrows (spacing between source and second instance, Z-offset arrows above it, X and Y shift arrows out of its side) on a real model.
- [ ] Circular array: drag the pie grip past 180 to 360 degrees, double-click the degrees to type, wheel and double-click the count badge. Concentric array (new): count, rings, spacing and grow badges stay legible when close together; tell me if the parameters are what you meant.
- [ ] Countersink angle arc (Add countersink to hole) follows the cone; counterbore and countersink "Offset from hole" entry; Add slot gizmos (depth grip when through, the angle arc); Cut with plane card: the dark list popup and the XY / XZ / YZ buttons (Split with plane shares the layout).

### Sketch: drawing and dimensions (look and feel)

- [ ] Look at the changes from your 2026-10-27 review: the lavender for under-constrained geometry (is the shade right on the dark theme?), the centre crosses on circles and arcs, the gray parenthesised sizes while drawing a rectangle and a circle, tangent / Fixed / Lock / Equal marks as button icons (tangent between a line and two circles), the bottom-right list of selected objects, and the drop list under the Horizontal / vertical and Dimension buttons. Default if unanswered: all stay as built.
- [ ] Thread hole (Holes group): pick a drilled hole's round wall, choose M6, apply; look at the thread in the view and Undo it. Try a counterbored hole, a blind hole, Left hand and a Length.
- [ ] Right-click a Fixed mark > Dimension to the axes, then right-click one of the two distances > Fix the point; click a mark and press Delete to remove one constraint.
### Sketch: tools

- [ ] Fillet and Chamfer sketch tools, Trim (piece between a line end and an arc), Split at a point on a line, Rectangle corner styles (Square, Rounded, Bevelled), sketch-only keys C E S H T L R.
- [ ] Symmetric about an axis (line ends above and below the x-axis stay mirrored; Sym marks sit at each point) and Fixed/Lock (a Fixed circle centre cannot be dragged; the degrees of freedom count matches; tooltips say what they do). The ellipse case (top and bottom quadrant points plus the x-axis) is a plan row again. Try your original steps and tell me if it still looks wrong.
- [ ] Ellipse arc tool: the five clicks (centre, long-axis end, short-radius point, start, end), the start and end direction, dragging an end along its ellipse, and Split on an ellipse (the cut point is marked only when hovered).
- [ ] Fillet and Chamfer on a line and an arc, two arcs and a circle: first click a curve, second click the side (real-mouse feel of the two-curve pick).
- [ ] Dimension and Horizontal / vertical drop lists (the small arrow beside each button) and the rule that only a click on empty space applies an open tool, with a real mouse on every tool card and gizmo.
- [ ] Fillet/Chamfer with edges selected: the Two distances chip (which side is first for edges on other faces).
- [ ] .ifc and .3dm in the native file dialogs: export both, open them in another program, import them back (IFC needs the optional IfcOpenShell extra; exports are lossy meshes/facets).
- [ ] New sketch arc tools with a real mouse: Tangent arc, Arc by ends and radius, Start angle and Sweep fields, Circle and Arc tangent to curves; Round / Bevel corner on line-arc and arc-arc corners; Trim and Extend at ellipse and spline crossings (the last three were not clicked in the browser).
- [ ] Sketch parity with a real mouse: Shift/Ctrl+click a kept sketch's curve chooses the sketch; snapping to sketch ends, centres and midpoints; Array along path and Sweep face with a chosen sketch (sweep tested in the core only); the View button starts a sketch square to the camera and the plane stays fixed after orbiting.
- [ ] After the app split (selection, drag and preview, sketch solve code moved to new files): click, Ctrl-click and double-click selection, box select, push/pull and Move drags, and a sketch session with a real mouse feel and behave as before.
- [ ] Edit cut Length and Width grips on a slot (tested in the core only).
- [ ] Newest user constraint wins: a constraint that repeats an automatic one removes the automatic row with a warning naming it.
- [ ] Drag of a free line, circle or point (snaps, guides, nothing else moves).
- [ ] Free circle: dragging its rim resizes it with the centre fixed, dragging its centre moves it; ellipse quadrant vertex rotates it with both construction lines live, and moving an ellipse feels smooth (checked only with synthetic pointer events).

### Model: faces, edges and selection (look and feel)

- [ ] Measure (M) pressed right after pressing a face; measuring after other tools; Ctrl+double-click an edge with faces already selected keeps them.
- [ ] Click an X/Y/Z axis line near the model (it highlights; nearer faces and edges win); pick a sketch region and Ctrl+click an edge or axis (the region stays picked, Revolve face runs); Revolve face with only a face and its Axis list; Draft > Pick axis near an edge end; press M while dragging push/pull and double-click a candidate (nothing else starts). Stretch: send me the part where it fails.
- [ ] Union two separate bodies (one compound row in the Bodies list; push/pull, export and undo work on it); choose a whole sketch in the Sketch list, Ctrl+click an edge or axis and run Revolve face; choose a round wall with a sketch drawn on the unrolled wall and run Emboss / Cut along surface.
- [ ] Selection feel: shift-select and the chips (what they are for), hard-to-hit small faces and edges, double-click chains that add non-tangent edges, box select with F, E, V filters and badge.
- [ ] Hole work with a real mouse: the Sizes preset list, push/pull and drag on a hole whose wall is two faces, and the display precision setting in tool forms, labels and drag rounding.
- [ ] Emboss and Cut along surface on a cylinder and a wrapped region; unrolled sketch on a cone, a flat-fillet-flat chain, and across a closed cylinder's seam.
- [ ] Section view (the cut-plane icon at the left of the view buttons above the nav cube): pick planes (Pick plane, XY/XZ/YZ, three points), drag the blue arrow and the slider through a model, Flip side, hatch angle and spacing differ per body and the lines are grey, two overlapping bodies show red where their cut faces overlap (try bodies that only touch: no red), and the view stays fast on a large imported part. Known limit: clicks still pick the hidden, cut-away part of the model.
- [ ] All tools usable at all times (new): with nothing selected open the tools drawer; the misfit tools should look only slightly dimmer, not blocked. Click Push/Pull or Extrude-like tools, Fillet and a two-face tool with the wrong selection: the status line says what to select, then select it and the tool's card or arrow appears as if preselected. Click another tool while one waits (the wait ends). Check the tooltip, and the "usable now" box still hides the dimmed ones. Default if unanswered: stays as built.

- [ ] Region picking over a coplanar body face (owner report 2026-10-29: "why is the solid face getting selected instead of the sketch area face?"): with a kept sketch moved onto a body face (YZ sketch moved to the -X face, so the region normal opposes the face's outward normal), hover and plain-click, Ctrl-click, and Shift-click a region over the face, with the face not selected and then selected. Expected (behavior.md): the region lights and is picked, never the face. The code reads right (`profileUnder` uses a double-sided fill and a 1.001x distance test, `clickOrProfile` and the hover prefer it over a face), so the cause was not found without a browser; the one known way a face wins is a face that is already selected (pressing it starts its drag). Note what was selected before the failing click.

### Hole Editor (new)

- [ ] Hole Editor entry and sections: choose Hole Editor in the drawer (and the search) with a flat face selected (a new hole: Simple, Counterbore, Countersink, preview at once, presets fill the hole and screw sizes), with a hole selected (Size & position, Counterbore, Countersink, Thread on a whole wall, Fill), and with several hole walls selected (Size, Move, Align, Distribute, Fill); check the picture labels focus their fields and that the old hole buttons are gone from the drawer, the strip and the search. Default if unanswered: stays as built.
- [ ] Preset values still unverified (no readable source): inch 82 degree flat head countersink diameters, and the inch tap drills other than 1/2-13 (the number and letter drills; published tables only list metric-rounded drills that agree within rounding). The metric clearance series and metric 90 degree countersinks are now checked against published tables. The table is `app/src/holepresets.ts`; the header comment says which are which. Default if unanswered: the values stay as entered.

### Decisions

(none open; the session B review is in the plan, see progress.md "Review of 2026-10-26 session B")


## Future

- [ ] Touchpad and touch devices: the owner has none; general users test sizing and gestures and report back, and problems become rows.
