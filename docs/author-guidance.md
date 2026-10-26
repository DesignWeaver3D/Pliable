# Author guidance

The only list that asks for the owner's time. It holds what tests and the decision hierarchy cannot settle: things a person must see or feel, real choices, and anything that would override an approved entry in [behavior.md](behavior.md).

Rules for keeping it:

- Sorted by priority, then grouped by tool or workflow within each priority, so related checks are done in one sitting. When adding an item, put it in its group and re-sort; never append at the end.
- Priorities: **High** (possible bugs, data loss or workflow-breaking behavior), **Normal**, **Future** (long-term choices, no work waiting on them).
- Not listed here: any default that follows the decision hierarchy (see the project instructions file, "Deciding without the owner") and has passing tests. Those are finished; the reason is one line in [decisions-log.md](decisions-log.md) or the commit message. Problems found later come back as bugs or GitHub issues.
- Each item says what to do and see (or the question), and the default that stands if unanswered. A passed or answered item is deleted; git keeps the history. An approved behavior goes into behavior.md in the same commit.

## High priority

### Possible hangs, blank views and data loss

- [ ] Blank 3D view after a sketch constraint (symmetry): not reproduced. If the view goes white again, do not refresh; copy the status line, which now names the failing part, and note the steps.
- [ ] Push/pull direction arcs: tilt the arrow by hand, press Escape, then click Menu. A scripted test froze the tab here; check it is only the test method.
- [ ] Restore prompt: kill the core and restart it; the previous model is offered once. Two copies running at once never offer or touch each other's session.
- [ ] Unsaved-work warning: leaving the page with an open sketch and nothing else changed still asks first.
- [ ] A long open shows the busy indicator and the UI stays responsive; it clears after a failed operation too. Opening the block model while a 109-solid STEP is loaded takes seconds, not 150 s.
- [ ] Editing a diameter after a redundant-constraint error does not crash the core (if it does, copy the core console output).

### Desktop app (Windows archive)

- [ ] Unzip, run, open the bracket, push/pull, export STEP. The window icon shows, the window resizes cleanly, and an export download works in the webview. macOS and Linux archives are untested.

### Sketch zoom

- [ ] Zoom to fit in a sketch with about ten shapes filled only a third of the view width and left a stray point at the far left (seen in the v0.4.0 build). Confirm or dismiss; also fit-selection with a selection, and that nothing hides behind the top strip.

### Inset face edges

- [ ] Loop 1 on a plain bracket (no overlapping duplicate body): the face count goes up and the Bodies list does not gain new bodies. A test model once went from 4 to 6 bodies.

## Normal priority

### Gizmos and handles that need a real mouse (hold the button down)

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
- [ ] Newest user constraint wins: a constraint that repeats an automatic one removes the automatic row with a warning naming it.
- [ ] Drag of a free line, circle or point (snaps, guides, nothing else moves).

### Model: faces, edges and selection (look and feel)

- [ ] Selection feel: shift-select and the chips (what they are for), hard-to-hit small faces and edges, double-click chains that add non-tangent edges, box select with F, E, V filters and badge.
- [ ] Hole centre dots, per-tool applies-to chip (Resize hole also resizes same-size holes by default), Move hole/boss with several holes.
- [ ] Emboss and Cut along surface on a cylinder and a wrapped region; unrolled sketch on a cone, a flat-fillet-flat chain, and across a closed cylinder's seam.
- [ ] Face Draft pivot (Pick axis, then an edge of its own face or another edge), and Cut with plane with its Remove side list and Pick plane.

### Decisions

- [ ] Remove fillet/chamfer, Fill hole / remove boss and Chamfer (distance and angle) now overlap Defeature on the bracket's fillets and round holes. Remove any of them? Default: keep all three.
- [ ] Distribute holes/bosses spaces holes along one axis only, so the four bracket base holes spread unevenly. Keep for single rows, or remove in favour of arrays on features? Default: keep, tooltip only.
- [ ] Smart dimension menus: should they also offer Radius, Coincident, Parallel, Perpendicular and Angle so the matching buttons can go? Default: keep the buttons.
- [ ] Dimension and Horizontal/Vertical variants under one tool (drop list under Dimension for horizontal and vertical distance; drop list under Horizontal / vertical for the strict ones). This changes the approved button row in behavior.md. Approve the layout?
- [ ] Using a gizmo must not apply the tool; only a click on empty space applies it. This changes the approved rule in behavior.md that clicking another item also applies. Approve?
- [ ] Inset face: the clickable ball that switches all edges / perimeter. Should other tools with an option use the same ball? Default: no change.
- [ ] Wall draft angle in place: leave it to the Draft tool, show the tag only while Draft is armed, or add an angle field to the push/pull card? Default: Draft tool only.
- [ ] Global display precision (1 to 8 decimals, default 3) covers measurements and sketch dimensions. Extend it to tool forms, manipulator labels and drag rounding? Default: yes, later.

## Future

### Stored recipes and arrays

- [ ] Should an array keep its count and spacing for later editing (a stored recipe a "separate" command restores, or a compound with its source), or stay plain separate solids as now? Default: plain solids.
- [ ] Edit a pattern from one of its members (needs a light pattern record; depends on the previous item).

### Design intent and push/pull

- [ ] Up To and Full Pull for push/pull (reference picks), or typed distances only? Default: typed distances only.
- [ ] Soft locks on relationships (re-checked after every edit, risk of silently stale locks), or re-detect only? Default: re-detect only.
- [ ] After editing a part with fillets, re-add the fillets automatically ("round last") or only on failure? Default: only on failure.

### Formats and structure

- [ ] Build IFC (IfcOpenShell, LGPL-3.0, 42 to 55 MB per platform) and .3dm (rhino3dm, MIT, about 2.5 MB, needs own trim conversion)? Default: not built.
- [ ] Split `sketch.ts` and `main.ts` into modules now, or keep adding features? Default: keep adding features; the architecture plan holds the order.
