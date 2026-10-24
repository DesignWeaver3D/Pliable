# Vetted behavior

Behavior the owner has stated or approved by hand. Treat every line as a requirement: do not change it, even to fix something nearby, unless the owner asks. If a task seems to need a change here, stop and ask. Read the section for the area you are about to touch before editing.

How to maintain: add a line when the owner approves a behavior or corrects one, written as "when X, Y happens". Keep it short and observable. Reasons and alternatives belong in [decisions-log.md](decisions-log.md). Items still "awaiting owner" in [progress.md](progress.md) are not vetted and do not belong here yet.

Seeded on 2026-10-20 from the owner's statements in the decisions log. The owner should correct or extend it.

## Selection and picking

- Left to right box select encloses; right to left touches. Holding F, E or V during a box drag restricts it to faces, edges or vertices.
- Shift+click and Ctrl+click both add to or remove from the selection, in the 3D view and in sketches. A plain click in a sketch adds to the selection.
- Double-click on an edge selects the tangent-continuous chain; Ctrl+double-click adds it. A double-click on a face selects its whole body.
- Pick ranges are 5 px for edges and 8 px for points and come from settings, never inline constants.
- Relationship chips (coplanar, equal radius and so on) are off by default, with All/None and Parallel/Symmetric. Resize hole also resizes same-size holes.
- See-through is the X key; repeated click or Alt+click cycles faces behind.
- Selecting a body in the 3D view scrolls its row into view in the bodies list.

## Navigation and view

- Wheel zooms toward the cursor, right-drag orbits, middle-drag pans, including during a tool drag.
- View keys: 0 iso, 1 front, 2 top, 3 right, 4 rear, 5 bottom, 6 left, P projection, V look at face.
- Entering a sketch does not move the camera; the Look at plane button does. It turns the view square to the sketch plane in orthographic projection; when the view was perspective, turning the camera away from the sketch (not zooming or panning) goes back to perspective.

## Keys

- Bare keys may change view, display, arm a tool or change selection. Anything that changes the model or a setting at once needs Ctrl or Alt.
- Every hotkey is user-redefinable except the fixed sketch keys (Ctrl+Z, Escape, Enter, Delete/Backspace). Any mix of Ctrl, Alt and Shift is allowed.
- Measure pick is the rebindable command "measure", default M.
- The page warns when leaving with undo steps or an open sketch.

## Tools and drags

- Pressing on a face or edge selects it and starts its drag in one motion; a press without movement is a click.
- One drag sets one value. Typing digits during a drag starts value entry: Tab switches fields, Enter commits, Escape cancels. The shape moves only on Enter.
- A failed preview keeps the last good size and shows the status in red; release commits the last good size.
- Each tool with a drag parameter has on-screen handles, one per parameter; with a form open a handle sets the form field.
- Handles show their name and value only for the one under the pointer. Diameter parameters have a radius handle plus a perpendicular double-ended diameter handle.
- Holding Shift while left-dragging a face makes push/pull symmetric: a sketch face about its sketch plane, two parallel faces about their mid-plane, one face about the global origin plane or a datum plane. Pressing or releasing Shift during the drag switches the mode from then on (provisional).
- When the push/pull arrow handle on a selected face is dragged, it starts the same drag as pressing the face: measure pick (M or right-click), typed value, Shift symmetric and companion faces all work the same.
- Move and rotate are one tool (Move/Rotate). Rotate and scale pivot about each the current move base point.
- Primitives are separate bodies by default. Sketch extrude are Join if intersecting a body or separate bodies if no intersection with any body.
- Dimensions are edited in place by double-clicking the text; an edit runs the ordinary tool as one undo step. Impossible edits show the reason in red and change nothing.
- Warnings show in orange; red is for errors.
- Dimension values, leaders and arrowheads are off-white, and they and the handle grips sit on a thin, 60% opaque dark outline (approved), so they stay readable over light bodies without looking hard-edged.

## Bodies

- The bodies list is a persistent plain list on the left of the 3D view, outside the drawer. Rows have a name, eye and isolate; right-click gives Rename, Duplicate, Delete and Edit primitive.
- Clicking a row selects the whole body; tools then use bodies directly.
- Each body has a stable id and an auto name; rename is an undo step.
- When a different model is opened (demo, import, project, resume), every body starts visible, solid and out of focus.

## Sketch

- Sketches are kept as separate objects. Finishing a sketch adds no faces to the model; closed regions show as tinted view-only profile faces.
- Automatic constraints are off by default, and unconstrained geometry floats freely. The grid is off by default; grid options live in the gear on the sketch card, not the global settings.
- Sketch card sits under the nav cube: title and gear on the first row, icon row, then Finish and Discard.
- Right-click in a sketch not on sketch geometry ends the current drawing tool.
- Project model edges is a pick mode: pick faces and edges, Enter or the button projects, Escape cancels. Projected edges are snapshots.
- A sketch dimension's value is a plain number; no expressions or named values yet.
- Clicking a kept sketch's tinted region adds it as a temporary face; clicking away without using it undoes the pick.
- Closed areas in a sketch are faces even when the geometry that encloses them shares no end points: lines that end on another line split it, so a rectangle with a divider drawn between two of its sides is two faces, and three lines attached to a side enclose a third. Lines that enclose nothing make no face.
- While a sketch shape is being drawn, typing digits starts a size entry for the next point: Tab (or space) moves to the next number, Enter places the shape. Rectangle takes width and height, slot length and width, ellipse long and short radius, arc radius and sweep degrees; line, circle and polygons take one number.
- Every sketch drawing tool except Line returns to Select once its first shape is complete; Line keeps drawing.
- While a sketch is open, the nav cube's zoom to fit everything fits all geometry of the sketch being edited, and zoom to fit selection fits the selected sketch points and curves.
- In a sketch, Delete with only points selected removes what holds them to other geometry (a coincident constraint, or the shared end of two lines, which is split in two) and leaves the lines; a point nothing holds is deleted with its geometry as before.
- The sketch constraint list shows every constraint when nothing is selected, and only those that name the selected curves or points (or points of the selected curves) otherwise. A point where drawn curves meet is listed as an automatic Coincident row; its x splits the point so the curves have their own ends.
- The value of a sketch dimension sits on a padded patch of the view's background, so the arrow, extension and leader lines under it look broken.
- Dragging a single sketch point snaps it to the grid (when snap to grid is on), to the sketch axes, or in line with another point (guide lines show); it never snaps onto another point or curve, so a drag does not join geometry.
- When a linear sketch dimension's value is pulled past either extension line, its arrows move outside the extension lines pointing inward (one at each), and no line is drawn between the extension lines (only a line from the near arrow out to the value); back between the lines it is the inside double arrow again.
- In a sketch the D key (or the Dimension button, listed first in the constraint row) applies the smart dimension to the selection: one fitting constraint or dimension is applied at once; when several fit, a small menu next to the cursor lists them. One line, circle, arc or ellipse gets its length, diameter, radius or short radius; two points very near each other (the pick tolerance) get a coincident constraint, otherwise a menu of distance, horizontal and vertical distance; two parallel lines get the distance between them, other pairs of lines the angle; a point with a line or curve, two circles or arcs, and a line with a circle give the matching distance; three or more items offer only symmetric, midpoint, equal, collinear, concentric or coincident sets. With nothing usable selected a message says what to select. Never several dimensions at once. Redefinable like other hotkeys; it does nothing outside a sketch.
- A dimension that is redundant with the existing constraints is created as a reference dimension (shown in parentheses, driving nothing) with a warning. A reference dimension is made driving with the icon button in the constraint list, or by right-clicking its value in the sketch view (click a value to select it, Shift or Ctrl adds, so several switch at once); a driving dimension that becomes redundant by that turns into a reference. A redundant geometric constraint is dropped with a warning; there are no geometric reference constraints.
- The angle between two lines is the inside angle by default; dragging its value across the lines into another sector switches it to the outside angle (the supplement, never more than 180 degrees) and back.
- Horizontal and vertical constraints apply to several selected lines at once; by default both kinds are applied as detected (nearly horizontal lines get horizontal, nearly vertical get vertical).
- Every dimensional constraint (any constraint holding a number) is editable on screen by double-clicking its dimension leader or its number.
- When a numeric constraint is created, its dimension appears immediately with the as-created value prefilled and ready for editing.

## Layout

- The tool strip is fixed at top centre. The context strip has no box behind it, fills each row from the left, spans from the bodies list to the nav cube group, wraps to two rows, and shows "... More" only when a third row would be needed.
- The Tools handle sits on the left edge of the 3D view.
- Edit cards (tool forms) sit at the right under the nav cube group like the sketch card; the measurement card moves left only when an edit card reaches it.
- The measurement card starts collapsed and sits bottom right. 
- Dark theme only for now.
- When faces, edges or vertices are selected and the view is right-clicked without dragging, a menu offers "Select parent bodies" (the owning bodies replace the selection); with a single face or edge, the Select similar choices come first. (Provisional.)
- A resize grip (cube) sits on its anchor with its stem running inward toward the solid; only the cube is grabbable. A move arrow is grabbed only by its arrowhead, not its line.
- A tip stays on screen until its Got it is clicked, even after the action that raised it ends. The chips (such as Add Parallel Face) and the hint line never overlap: the hint line and tip stand above the chips. There is no separate sketch key hint line.
- The sketch plane move and turn gizmos are off by default; the sketch card button shows them.
- Sketch constraint tools that only apply to edges ignore selected vertices instead of doing nothing.
- While a sketch is open the top strip has a second row with all constraint and dimension buttons, greyed unless the selection takes them. (for testing before the UI is slimmed)
