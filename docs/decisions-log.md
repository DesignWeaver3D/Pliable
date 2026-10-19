# Decision log

Decisions made without the owner or by the owner, grouped by topic. Each says what was decided and what to change if the owner disagrees. A record for later reference; real questions go in [questions.md](questions.md). Decision order when the owner is away: described workflow, industry practice for solid modelers, other direct modelers, web consensus.

## Owner direction

- No history tree: smart re-edit of the last operation, "Edit last" works only until another change is made.
- Sketches are not kept after closing; closed regions become faces on Finish sketch. Add persistence later if needed.
- Combine STEP places the other file at its own origin; revisit only if it becomes a problem.
- Wanted: variable fillet and chamfer with per-edge choice and on-screen control (S47); pick several solids and move them singly or as a group; hole axis line with end points rather than a centre point (S48); unwrap distortion is acceptable if obvious (S46).
- Words: a dimension has extension lines, a dimension line and arrowheads; a leader is text with a line pointing at something.
- Box select: left to right encloses, right to left touches, with the current colours. Loops follow shared faces, not angle.
- Keyboard: bare keys are fine if they do not at once change the model or a global setting; every hotkey is user-redefinable; any combination of Ctrl, Alt, Shift may be a modifier (S53).
- GUI (S34): fixed context strip, permanent search, labels with icons, no radial menu, drawer replaces the left list, dark only. Tablet only while cheap.
- Usage counts are wanted for GUI planning, only inside the diagnostics report; remove if testers object.
- Alpha notice is acknowledged once per user; no portable-mode marker for now.
- Resize hole also resizes same-size holes by default (owner chose to keep); other tools affect only the selected feature.

- Body list (S65): stable body ids and auto names; a plain list on the left in the drawer (not a card); rows with name, eye and isolate, rename and later actions by right-click; clicking a row selects the whole body and tools use bodies directly with a body-centre pivot; hover highlight both ways.

## View and selection

- Orthographic is a true orthographic camera. The owner says it still looks off compared with another CAD program and the cause is undiagnosed; candidates are shading and lighting, orbit about the target versus the cursor, zoom toward the cursor, line widths, default isometric direction, framing on projection switch. Needs a screenshot pair.
- View keys: 0 iso, 1 front, 2 top, 3 right, 4 rear, 5 bottom, 6 left, P projection, V look at face (mean normal; wrap-around faces look along the axis from the centre).
- Pick ranges default to 5 px for edges and 8 px for points (`settings.ts`). Box select takes the kind already selected, or the Box selects setting.
- See-through (X) draws a 30% opaque surface; picking has no depth limit; repeated click or Alt+click cycles faces behind.
- Double-click an edge selects the face outlines beside it, falling back to the smooth chain (`viewport.onEdgeLoop` in `main.ts`). Ctrl+double-click adds.
- Edge ring over faces with more than four edges takes the farthest parallel straight edge. Sharp edges default to 30 degrees (`selectionHelpers` in `main.ts`).
- Hole centre dots are alternate pick targets for the hole face, not a new selection kind (`nearestCentre` in `viewport.ts`); they drag to move the hole.
- Relationship rules: related faces are found as coplanar, equal radius, coaxial; chips toggle them. Per-tool defaults are `TOOL_RULES` and `ruleFor` in `main.ts`; coplanar on, equal radius off except Resize hole; Move hole with equal radius moves all clones by one vector.
- Measure pick moved from right-click to M during a drag so right-drag can orbit (discoverability is S55).
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
- Sketch body drag pins all of a line's or circle's points at the pointer offset. The sketch agent found no solver floating bug; the cause of the owner's report is unknown (S43).

## Keys

- Bare keys may change view, display, arm a tool or change selection; anything that changes the model or a setting at once needs Ctrl or Alt (to be widened per S53). Bare keys need the pointer over the view (1.5 s grace); there is a single-key off switch; no two-key sequences; undo/redo are blocked during a live drag or typed entry; browser keys, Escape, Enter, Tab, Backspace, Delete and Space are reserved (any mix of Ctrl, Alt and Shift is allowed, S53).
- Sketch keys (Ctrl+Z, Escape, Enter, Delete/Backspace) are fixed. Escape works without engagement. Measure pick is the command "measure" (default M, class display, allowed while a drag is live via `duringEntry`).
- The page warns when leaving with undo steps or an open sketch; opening a file over edits does not warn.

## Platform

- Usage counts live in core memory only (header of `usage.py` says how to remove).
- Autosave: per-instance folder with a heartbeat lock, dead after 30 s or when the pid is gone, at most 5 old sessions, a restore deletes its source, newer formats are never offered or deleted, `PLIABLE_DATA` overrides the folder.
- The alpha notice lives in `notice.json` with `NOTICE_EPOCH` in `notice.py`; bump it only when the risks change materially.
- Packaged builds serve HTTP on 127.0.0.1 only; the launcher exits 20 s after the last tab closes.

- Shift+click in the 3D view adds to or removes from the selection exactly like Ctrl+click (the sketch already did this), so it has one clear meaning; double-click on an edge selects only the tangent-continuous chain and Ctrl+double-click adds it.
- GUI stage 1-3 (S34): the strip lists at most seven tools, the one a drag runs first and marked, plus an All tools button that opens the drawer filtered to usable tools; the measurement card starts collapsed (click its title to expand), which answers the open card question provisionally; icons are built from a base shape plus a mark in `app/src/icons.ts` and a tool with none shows its initials; the T key toggles the drawer (rebindable).

## Handles (S28, S47)

- One kind of handle: a point that slides along a straight line; a rotation is the ring point with its tangent and degrees per unit; yes/no parameters (reverse ends, swap sides) are click markers (`toggle`). The core sends handles with every preview and on `tool_handles`; the view keeps a dragged handle where the pointer is and snaps it to the reply.
- With a selection and no form open, the tool a drag would run shows its handles and a handle drag runs the same drag path as dragging the face or edge (so one undo step); with a form open a handle sets the form field, so typed entry and handles stay in step.
- Only the handle under the pointer shows its name and value; showing all labels overlapped on small models. Change in `Manipulator.update`.
- Primitive position arrows sit a little off the reference point so the three tips do not overlap; they point away from the primitive and move it the opposite way, which feels like pulling it.

- Tools button moved from the top bar to a handle on the left edge of the 3D view (rides on the drawer edge when open); its icon is a placeholder pending the owner's choice among candidates.

## Base point by pick (S64)

- Move body, move hole, pattern hole and linear array declare `move_vector` (dx, dy, dz). The form offers "Pick base point" (then goes straight on to the destination) and "Pick destination point"; the vector is destination minus base, and the base defaults to the origin. Typing a vector value forgets the picked destination.
- Primitives declare `anchors` (the corner, centre and face centres of the new shape as offsets from the placement point). The form has a "base point" list and "Pick destination point"; the stored parameters stay the placement point and sizes, only the origin is set to destination minus the anchor offset. The base of a not-yet-placed shape is chosen from the list because there is nothing to click on before it exists.

- 2026-10-19 (S65): Body ids and names are carried by matching solids (same shape, then bounding-box overlap, then equal volume) rather than by per-operation face history, because most tools rebuild the shape and return no history; whole-body transforms match by position. Rename is an undoable step.

- 2026-10-19 (S48, answers to holes questions 1-4, defaults used while the owner is away): (1) round holes only for now (plain, counterbore, countersink, blind or through); non-circular cuts and slots are pockets, and the hole tools say so; obround slots are a later addition. (2) The hole axis is drawn as a line with the far end as the depth handle (the end of its range is "through") and the middle as a move handle. (3) Hole axis end points and the circle centre of a rim edge are snap points in the point picker; the centre dot stays an alias for the hole face. (4) An existing hole converts to a countersink (diameter and included angle); the edge chamfer stays a separate tool.
- 2026-10-19 (S48): A hole is found from any of its faces or its opening rim by walking the faces around one axis (full cylinders and cones facing the axis, and flat shoulders whose neighbours are all hole walls). The opening is the end away from a bottom, else the end with the wider stage, else the end that runs toward negative axis direction. Editing fills the old cut with a revolved profile and cuts a new one.
- 2026-10-19 (S71): Handle-drag previews are latest-wins with one request in flight (the core answers in order, so queueing every pointer move showed nothing until the pointer rested). Previews skip the per-edge drag direction (the main meshing cost; nothing is dragged on a preview). A move arrow slides the bodies it moves on the client at once; the moving set is inferred from the shift of body centres between two previews instead of re-implementing each tool's rules on the client. Resize grips are left to the core round trip (about 32 ms).

- 2026-10-19 (S56, provisional, owner away): dimensions are edited in place only where the edit has one meaning (hole diameter, fillet radius, box edge length, face-to-face distance, hole centre distance, draft angle). An edit runs the ordinary tool (Resize hole, Resize fillet, Push/Pull, Move hole, Draft) so it is one undo step and previews like the tool. The face clicked last moves by default, with a flip control; an impossible edit shows its reason in red and changes nothing.
