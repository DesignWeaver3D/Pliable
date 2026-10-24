# Decision log

Decisions made without the owner or by the owner, grouped by topic. Each says what was decided and what to change if the owner disagrees. A record for later reference; real questions go in [questions.md](questions.md). Decision order when the owner is away: described workflow, industry practice for solid modelers, other direct modelers, web consensus.

## Owner direction

- No history tree: smart re-edit of the last operation, "Edit last" works only until another change is made.
- Sketches are not kept after closing; closed regions become faces on Finish sketch. Add persistence later if needed.
- Combine STEP places the other file at its own origin; revisit only if it becomes a problem.
- Wanted: variable fillet and chamfer with per-edge choice and on-screen control; pick several solids and move them singly or as a group; hole axis line with end points rather than a centre point; unwrap distortion is acceptable if obvious.
- Words: a dimension has extension lines, a dimension line and arrowheads; a leader is text with a line pointing at something.
- Box select: left to right encloses, right to left touches, with the current colours. Loops follow shared faces, not angle.
- Keyboard: bare keys are fine if they do not at once change the model or a global setting; every hotkey is user-redefinable; any combination of Ctrl, Alt, Shift may be a modifier.
- GUI: fixed context strip, permanent search, labels with icons, no radial menu, drawer replaces the left list, dark only. Tablet only while cheap.
- Usage counts are wanted for GUI planning, only inside the diagnostics report; remove if testers object.
- Alpha notice is acknowledged once per user; no portable-mode marker for now.
- Resize hole also resizes same-size holes by default (owner chose to keep); other tools affect only the selected feature.

- Body list: stable body ids and auto names; a persistent plain list on the left of the 3D view, outside the drawer (not a card; the drawer opens to its right, the tool form and measurement card sit beside the list or drawer, the context strip is centred in the room between the left side and the nav cube); rows with name, eye and isolate, rename and later actions by right-click; clicking a row selects the whole body and tools use bodies directly with a body-centre pivot; hover highlight both ways.

- First alpha release is deferred by the owner (2026-10-19) until more of the current work has been tested; the build and CI stay as they are, no tag.

## View and selection

- Orthographic is a true orthographic camera. The owner says it still looks off compared with another CAD program and the cause is undiagnosed; candidates are shading and lighting, orbit about the target versus the cursor, zoom toward the cursor, line widths, default isometric direction, framing on projection switch. Needs a screenshot pair.
- View keys: 0 iso, 1 front, 2 top, 3 right, 4 rear, 5 bottom, 6 left, P projection, V look at face (mean normal; wrap-around faces look along the axis from the centre).
- Pick ranges default to 5 px for edges and 8 px for points (`settings.ts`). Box select takes the kind already selected, or the Box selects setting.
- See-through (X) draws a 30% opaque surface; picking has no depth limit; repeated click or Alt+click cycles faces behind.
- Double-click an edge selects the face outlines beside it, falling back to the smooth chain (`viewport.onEdgeLoop` in `main.ts`). Ctrl+double-click adds.
- Edge ring over faces with more than four edges takes the farthest parallel straight edge. Sharp edges default to 30 degrees (`selectionHelpers` in `main.ts`).
- Hole centre dots are alternate pick targets for the hole face, not a new selection kind (`nearestCentre` in `viewport.ts`); they drag to move the hole.
- Relationship rules: related faces are found as coplanar, equal radius, coaxial; chips toggle them. Per-tool defaults are `TOOL_RULES` and `ruleFor` in `main.ts`; coplanar on, equal radius off except Resize hole; Move hole with equal radius moves all clones by one vector.
- Measure pick moved from right-click to M during a drag so right-drag can orbit.
- Dimension labels that would overlap: the first is kept, later ones dropped.

## Tools

- Every tool is a button grouped by `app/src/layout.ts`; tools without a drag parameter open a typed-value form with live preview. Resize hole takes a typed diameter (0 = unchanged) because forms cannot show current values.
- Resize fillet/chamfer re-make the round from the face (chamfers with equal legs). Resize fillet also edits variable fillets (end radius 0 keeps it constant). Fillet per edge is a separate tool from Variable fillet; fold them together if one tool is wanted. The kernel has no variable chamfer.
- Center between faces accepts the hole and two faces in any order.
- Array along path replaces the single-edge array: one or more connected edges, equal spacing by arc length, copies translated not rotated.
- Primitives default to separate bodies (`new_body`; 0 fuses). Sketch extrude defaults to Join in the UI (change the initial `mode` in `sketch.ts`, two places) and `new` on the server. Boss, arrays and push/pull join. `new_body` is a number box until a boolean parameter kind exists.
- Per-body move/rotate/scale/offset use selected faces to find solids; rotate and scale pivot about the model origin (a body-centre pivot is a one-line change).
- Emboss/Cut along surface is its own tool for curved faces so Push/Pull keeps its planar behaviour (relax `PushPull.applies` and add a drag normal to merge them).
- Eyedropper matches values by field name (see watchlist).
- Inset and divide face skip the coplanar merge (`unified=True`); every other tool merges coplanar faces after running.

## Sketch

- Rectangle makes four lines with horizontal/vertical constraints; lines within 3 degrees snap horizontal/vertical.
- Snaps onto a curve or midpoint add point-on or midpoint constraints (drop the `on` handling in `pointFor` in `sketch.ts` to stop). Whether sketch tools should add constraints on their own is question 12. Snap to an in-plane axis line adds no constraint.
- Automatic tangency: circle tool snaps its radius tangent; line ends snap to touching points on circles/arcs; arcs starting on a line end become tangent within 2 x `AUTO_AXIS_DEG` (`addArc`).
- Solver is SolveSpace (py-slvs, GPL-3.0, compatible with the AGPL project).
- Unwrap is exact for developable surfaces; a chain uses arc length so folds without tangency also unroll (add a tangency check in `_strip_unrolling` to forbid). The unrolled sketch hides extrude/revolve (flag `flat` in `renderPanel`). The plane is placed beside the model.
- Sketch body drag pins all of a line's or circle's points at the pointer offset. The sketch agent found no solver floating bug; the cause of the owner's report is unknown.

## Keys

- Bare keys may change view, display, arm a tool or change selection; anything that changes the model or a setting at once needs Ctrl or Alt. Bare keys need the pointer over the view (1.5 s grace); there is a single-key off switch; no two-key sequences; undo/redo are blocked during a live drag or typed entry; browser keys, Escape, Enter, Tab, Backspace, Delete and Space are reserved (any mix of Ctrl, Alt and Shift is allowed).
- Sketch keys (Ctrl+Z, Escape, Enter, Delete/Backspace) are fixed. Escape works without engagement. Measure pick is the command "measure" (default M, class display, allowed while a drag is live via `duringEntry`).
- The page warns when leaving with undo steps or an open sketch; opening a file over edits does not warn.

## Platform

- Usage counts live in core memory only (header of `usage.py` says how to remove).
- Autosave: per-instance folder with a heartbeat lock, dead after 30 s or when the pid is gone, at most 5 old sessions, a restore deletes its source, newer formats are never offered or deleted, `PLIABLE_DATA` overrides the folder.
- The alpha notice lives in `notice.json` with `NOTICE_EPOCH` in `notice.py`; bump it only when the risks change materially.
- Packaged builds serve HTTP on 127.0.0.1 only; the launcher exits 20 s after the last tab closes.

- Shift+click in the 3D view adds to or removes from the selection exactly like Ctrl+click (the sketch already did this), so it has one clear meaning; double-click on an edge selects only the tangent-continuous chain and Ctrl+double-click adds it.
- GUI stage 1-3: the strip lists at most seven tools, the one a drag runs first and marked, plus an All tools button that opens the drawer filtered to usable tools; the measurement card starts collapsed (click its title to expand), which answers the open card question provisionally; icons are built from a base shape plus a mark in `app/src/icons.ts` and a tool with none shows its initials; the T key toggles the drawer (rebindable).

## Handles

- One kind of handle: a point that slides along a straight line; a rotation is the ring point with its tangent and degrees per unit; yes/no parameters (reverse ends, swap sides) are click markers (`toggle`). The core sends handles with every preview and on `tool_handles`; the view keeps a dragged handle where the pointer is and snaps it to the reply.
- With a selection and no form open, the tool a drag would run shows its handles and a handle drag runs the same drag path as dragging the face or edge (so one undo step); with a form open a handle sets the form field, so typed entry and handles stay in step.
- Only the handle under the pointer shows its name and value; showing all labels overlapped on small models. Change in `Manipulator.update`.
- Primitive position arrows sit a little off the reference point so the three tips do not overlap; they point away from the primitive and move it the opposite way, which feels like pulling it.

- Tools button moved from the top bar to a handle on the left edge of the 3D view (rides on the drawer edge when open); its icon is a placeholder pending the owner's choice among candidates.

## Base point by pick

- Move body, move hole, pattern hole and linear array declare `move_vector` (dx, dy, dz). The form offers "Pick base point" (then goes straight on to the destination) and "Pick destination point"; the vector is destination minus base, and the base defaults to the origin. Typing a vector value forgets the picked destination.
- Primitives declare `anchors` (the corner, centre and face centres of the new shape as offsets from the placement point). The form has a "base point" list and "Pick destination point"; the stored parameters stay the placement point and sizes, only the origin is set to destination minus the anchor offset. The base of a not-yet-placed shape is chosen from the list because there is nothing to click on before it exists.

- 2026-10-19: Body ids and names are carried by matching solids (same shape, then bounding-box overlap, then equal volume) rather than by per-operation face history, because most tools rebuild the shape and return no history; whole-body transforms match by position. Rename is an undoable step.

- 2026-10-19 (answers to holes questions 1-4, defaults used while the owner is away): (1) round holes only for now (plain, counterbore, countersink, blind or through); non-circular cuts and slots are pockets, and the hole tools say so; obround slots are a later addition. (2) The hole axis is drawn as a line with the far end as the depth handle (the end of its range is "through") and the middle as a move handle. (3) Hole axis end points and the circle centre of a rim edge are snap points in the point picker; the centre dot stays an alias for the hole face. (4) An existing hole converts to a countersink (diameter and included angle); the edge chamfer stays a separate tool.
- 2026-10-19: A hole is found from any of its faces or its opening rim by walking the faces around one axis (full cylinders and cones facing the axis, and flat shoulders whose neighbours are all hole walls). The opening is the end away from a bottom, else the end with the wider stage, else the end that runs toward negative axis direction. Editing fills the old cut with a revolved profile and cuts a new one.
- 2026-10-19: Handle-drag previews are latest-wins with one request in flight (the core answers in order, so queueing every pointer move showed nothing until the pointer rested). Previews skip the per-edge drag direction (the main meshing cost; nothing is dragged on a preview). A move arrow slides the bodies it moves on the client at once; the moving set is inferred from the shift of body centres between two previews instead of re-implementing each tool's rules on the client. Resize grips are left to the core round trip (about 32 ms).

- 2026-10-19 (provisional, owner away): dimensions are edited in place only where the edit has one meaning (hole diameter, fillet radius, box edge length, face-to-face distance, hole centre distance, draft angle). An edit runs the ordinary tool (Resize hole, Resize fillet, Push/Pull, Move hole, Draft) so it is one undo step and previews like the tool. The face clicked last moves by default, with a flip control; an impossible edit shows its reason in red and changes nothing.
- 2026-10-19 (provisional, owner away): search scope prefixes are t: tools, s: settings, b: bodies, v: view commands, f: files and demos; settings appear as "Setting: ..." entries; the Getting started card opens once on first use while hints are on (marked seen in the hints preferences) and is also under Menu and in the search.

- 2026-10-19: the diameter pattern (radius handle plus perpendicular double-ended diameter handle) is applied to cylinder, cone, sphere, torus, hole and countersink diameters; not to fillet/round radii, which are arcs along an edge. The label shows R or the diameter sign and the typed number follows it (`factor`). Torus tube handles sit on the -X side of the ring so they never overlap the ring handles.

- 2026-10-19 (provisional, owner away): sketch parity was built from the existing py-slvs solver instead of swapping solvers; the ellipse short radius is a plain parameter the solver sets, and spline or ellipse shape constraints stay unsupported (the one candidate solver has no macOS wheel). Kept sketches were parked: the document holds no sketches and the model has no history, so it needs the owner's direction. Reference dimensions are measured on the frontend and ignored by the solver. Mirror copies carry symmetric constraints marked automatic; other copies carry geometry only. Typed sizes while drawing become driving dimensions (dropped if they clash).

- 2026-10-19 (sketch feedback from the owner): automatic constraints default to Off because the owner reported geometry not floating freely when unconstrained; the old behaviour stays as a sketch setting. The grid is off by default with major and minor options in a settings gear on the sketch card (not the global settings). Entering a sketch no longer changes the camera; a Look at plane button does it on request.

- 2026-10-19 (hole feedback): the Edit hole tool has a depth grip at both ends of the bore. The far one keeps depth; the entry one is a new `start` offset (0 up to just short of the end) that leaves a skin of material below the face.
- Tools with an empty selection: hole tools need a selected hole face or rim (Accepts.any_of); whole-model body tools are offered with nothing selected only for a single-body model. Move and rotate are one tool (Move/Rotate, id move_body); rotate_body is hidden but kept for old requests. Holes are not rotated.

- 2026-10-20 (owner answers to the open questions): a hole is any cut-through void with shared move, resize and depth handles; counterbore, countersink and thread only on cylindrical voids, either or both ends, manual sizes for now. Every circle and arc edge gets a pickable centre. Selection filters both during (held keys) and after selection; Shift+click and Ctrl+click both add. One-time dismissible hints. Projected edges stay snapshots. Ellipses and splines keep endpoint constraints only. Sketch dimensions are numbers only (expressions on the long-term roadmap). Cut and Split merge into one tool with a keep choice, coloured halves and a freely placeable plane.
- 2026-10-20: which face moves when a face-to-face distance is edited in place is design-intent behavior tied to the auto-chip selections and is deferred to the long-term roadmap.

- 2026-10-20 (unattended): after a tab refresh the core's own parked model is resumed before any crash restore is offered; the crash-restore prompt now shows when the session was saved. Reason: the prompt was offering dead sessions of other (killed) test servers from the shared autosave folder while ignoring the model the live core still held.
- Context strip (owner): it has no box behind it, fills each row from the left before starting the next, and spans from the bodies list edge to the nav cube group, wraps to at most two rows, and shows "... More" (opens the drawer filtered to usable tools) only when the usable tools would need a third row. The nav cube group sits at the top right, level with the strip.

- 2026-10-22 (provisional, owner away): with two or more lines selected the constraint row shows "Horizontal / vertical" (each line gets the kind nearer its direction, so every line gets one), then "Horizontal" and "Vertical" forcing all lines to that kind. Lines that already have one, and reference lines, are skipped. One line keeps the old single buttons.
- 2026-10-22 (provisional, owner away): the Tangent and Collinear buttons are replaced by one "Tangent / collinear" button. Lines only: all made collinear with the first. A curve with a line or curve: tangent (with more than two items, only pairs that meet at a point).
- 2026-10-22 (provisional, owner away): the smart "Dimension" button sits after the other constraint buttons and stands for the specific dimension: line or two points length, arc radius, circle diameter, two lines angle, point and line distance, ellipse short radius. Axes cannot be selected, so a single line also gets an "Angle to horizontal axis" button (new axis_angle constraint). Angle dimensions show as a tag.

- 2026-10-22 (provisional, owner away): a new dimension is added at once with its measured value and a number field opens on its text; Enter sets the value, Escape or clicking away keeps the measured value (creation stays one undo step). The Reference tick of the old ask strip is gone from creation; the sketch list still toggles reference. Not checked in the app (no browser available).
- 2026-10-22 (provisional, owner away): the key hint line and the tips moved down to sit just above the create-sketch buttons (hint line 44px, tips 68px from the bottom). The sketch key hint has a close button; the choice is remembered and undone by turning hints off and on again.
- Datum planes (provisional): a datum plane is a named plane kept per undo step like kept sketches, made from any plane a sketch can sit on (origin plane, face, vertices, edge, each with an offset) or midway between two parallel faces. Listed under Sketches, drawn as a fixed 120-unit square, saved in the project file and autosave. Reason: reusing the sketch plane machinery keeps one way to describe a plane.
- Symmetric push/pull (provisional): the distance is applied to each side, so the face under the pointer follows it and its mirror face moves the same amount (a sketch face spans twice the distance in total). One face: the nearest origin or datum plane parallel to it that has a matching face across it; none found gives a message to add a datum plane. Two faces: both move by the distance along their own outward normals, which keeps their mid-plane fixed. Shift can be pressed or released during the drag (provisional): from then on the drag is symmetric or not, previewed at once, and the committed result follows the mode at release.
- Mirror modeling mode (provisional): a document-level mode, on for one plane (an origin plane, a face, or a datum plane) and off by default, kept per undo step and saved in the project file. After each tool or sketch extrude, the material the operation added is mirrored in the plane and fused in, and the material it removed is mirrored and cut out, so a symmetric model stays symmetric. Turning it on does not change the model. Whole-body moves are not mirrored. It is switched from the command search and shown as a line with an off button under the datum planes, with the plane outlined in orange.
- Alpha readiness (provisional): every tool has a dedicated unit test, so none is hidden or marked experimental; hand-check gaps are listed per row in progress.md and the watchlist, and the owner decides what to mark before the next alpha.
