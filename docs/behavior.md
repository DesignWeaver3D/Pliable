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
- Entering a sketch does not move the camera; the Look at plane button does.

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
- Holding Shift while left-dragging a face makes push/pull symmetric: a sketch face about its sketch plane, two parallel faces about their mid-plane, one face about the global origin plane or a datum plane.
- Move and rotate are one tool (Move/Rotate). Rotate and scale pivot about each the current move base point.
- Primitives are separate bodies by default. Sketch extrude are Join if intersecting a body or separate bodies if no intersection with any body.
- Dimensions are edited in place by double-clicking the text; an edit runs the ordinary tool as one undo step. Impossible edits show the reason in red and change nothing.
- Warnings show in orange; red is for errors.

## Bodies

- The bodies list is a persistent plain list on the left of the 3D view, outside the drawer. Rows have a name, eye and isolate; right-click gives Rename, Duplicate, Delete and Edit primitive.
- Clicking a row selects the whole body; tools then use bodies directly.
- Each body has a stable id and an auto name; rename is an undo step.

## Sketch

- Sketches are kept as separate objects. Finishing a sketch adds no faces to the model; closed regions show as tinted view-only profile faces.
- Automatic constraints are off by default, and unconstrained geometry floats freely. The grid is off by default; grid options live in the gear on the sketch card, not the global settings.
- Sketch card sits under the nav cube: title and gear on the first row, icon row, then Finish and Discard.
- Right-click in a sketch not on sketch geometry ends the current drawing tool.
- Project model edges is a pick mode: pick faces and edges, Enter or the button projects, Escape cancels. Projected edges are snapshots.
- A sketch dimension's value is a plain number; no expressions or named values yet.
- Clicking a kept sketch's tinted region adds it as a temporary face; clicking away without using it undoes the pick.
- Horizontal and vertical constraints apply to several selected lines at once; by default both kinds are applied as detected (nearly horizontal lines get horizontal, nearly vertical get vertical).
- Every dimensional constraint (any constraint holding a number) is editable on screen by double-clicking its dimension leader or its number.
- When a numeric constraint is created, its dimension appears immediately with the as-created value prefilled and ready for editing.

## Layout

- The tool strip is fixed at top centre. The context strip has no box behind it, fills each row from the left, spans from the bodies list to the nav cube group, wraps to two rows, and shows "... More" only when a third row would be needed.
- The Tools handle sits on the left edge of the 3D view.
- The measurement card starts collapsed and sits bottom right. 
- Dark theme only for now.
- When faces, edges or vertices are selected and the view is right-clicked without dragging, a menu offers "Select parent bodies" (the owning bodies replace the selection); with a single face or edge, the Select similar choices come first. (Provisional, S116.)
- A resize grip (cube) sits on its anchor with its stem running inward toward the solid; only the cube is grabbable. A move arrow is grabbed only by its arrowhead, not its line. (S118.)
