# Summary: wave 2a (2026-10-18)

The same four agents worked a second round and their branches are merged into `dev` locally (193 core tests, 21 node tests, typecheck and build pass; the kernel, selection and shell results were smoke-tested in Chrome, the sketch results only partly). Decisions are entries 34-41 below. Things to check: Resize hole now resizes same-size holes by default (entry 35); the alpha notice should be shown once per user (owner decision, planned as S42). Parked: dragging the divide edge, moving a picked body, spheres, tori and free-form unwrap.

# Summary: four-agent wave (2026-10-18)

Four agents worked in parallel worktrees, one per area (kernel, sketch, selection, shell), and their branches were merged into `dev` (177 core tests, 19 node tests, typecheck and build pass; smoke-tested in Chrome). Decisions are entries 21-33 below; per-session detail stays in docs/agent-notes/ until wave 2 is done. Open items: S25 needs your exact model and steps; S13 and S40 await your review; S30, S31, S35 and S37 have small leftovers listed in docs/progress.md.

# Summary for the owner's return (unattended session, 2026-10-18)

All six queue items were worked and pushed to `dev` (tests: 154 pass; no push to `rebuild` or `main`, no tags). Details are in docs/progress.md, decisions below as questions 15-19.

1. **Sketch regions become faces** when you press "Finish sketch" (new button; "Discard sketch" or Escape throws the sketch away). Zones lying on a flat model face are imprinted on it; others become loose faces that push/pull turns into solids. Checked in Chrome for a loose rectangle; imprinting onto a face and overlapping circles are covered by tests only.
2. **Centre rectangle** tool and a square/rounded/bevelled corner option for both rectangle tools (checked in Chrome).
3. **Edge helpers:** "All edges" and "Edge loops" buttons for a selected face (checked), and double-click an edge with another edge selected to take the loop of their shared face (not tried in a browser).
4. **Resize fillet** works on variable fillets and can switch constant/variable with an end radius. No variable chamfer exists in the kernel.
5. **Hole centres** are measured (centre, centre-to-centre, centre-to-face); Center between faces takes any pick order. Separately pickable centre points are not built (question 17).
6. **Offset curve** in the sketch (checked in Chrome) and **Array along path** over connected edges.

Not done / needs you: the open parts of S30, S31, S35, S37 listed in the progress table. I killed a stale core server on port 8765 to test my changes and left a fresh core server and the Vite dev server (port 5175) running.

# Questions for the user (overnight session, 2026-10-17)

Decisions were made with this order: your described workflow, industry standard, common practice in other direct modelers, web consensus. Each entry: what I decided, why, and what to change if you disagree. Development did not stop for any of these.

1. **Orthographic mode** (reopened): now a true orthographic camera, but the owner (2026-10-18) says it still looks off compared with the camera in the open-source parametric CAD program the owner uses and does not know why. Not diagnosed. Candidates to compare side by side: shading and lighting (headlight versus fixed lights), orbit around the target versus the cursor, zoom behaviour (scroll zoom toward the cursor), line widths, the default isometric direction, and how the switch from perspective keeps the framing. Needs a screenshot pair from the owner or a short session comparing the two.
2. **View keys** (owner 2026-10-18: all tested and good; this entry is informational, not a question):  Number keys for standard views (0 iso, 1 front, 2 top, 3 right, 4 rear, 5 bottom, 6 left), P toggles perspective/orthographic, V looks at the selected face (mean normal for curved faces; wrap-around faces such as a full cylinder use the direction from the model centre).
3. **Sketching** works in 3D space without a separate workbench: "Sketch on selected face" or on XY/XZ/YZ (bar at the bottom of the screen). Tools: Line, Rectangle, Circle, Arc; select/drag points with the solver; constraints (horizontal, vertical, coincident, fixed, parallel, perpendicular, equal, tangent, point-on, midpoint, symmetric, length/distance, radius, diameter, angle). Extrude joins or cuts. Solver is SolveSpace (py-slvs, GPL-3.0, compatible with the project's AGPL). Decided: sketches are not kept after extruding/exiting (no sketch objects in the model tree, matching "no history"); say if you want sketches to persist.
4. **Rectangle** creates 4 lines with horizontal/vertical constraints (common sketching convention); **auto horizontal/vertical** snapping within 3 degrees while drawing lines.
5. **Tool GUI:** every tool is a button in the left list, grouped by `app/src/layout.ts` (the one place to rearrange). Tools without a drag parameter open a typed-value form with live preview. Resize hole uses a typed diameter (0 = unchanged) because tool parameters cannot show the current value yet.
6. **Not built:** the stretch spike (waiting for you), sketch constraints between sketch geometry and model edges (projection), horizontal/vertical-distance dimensions, sketch fillet/trim tools.
7. **Relationship rules:** selecting a face finds related faces (coplanar, equal radius, coaxial); chips at the bottom show counts and toggle them; matches are highlighted faintly. A rule only changes tools that declare it (`Tool.related`): push/pull uses coplanar, fill/resize/move hole-or-boss use equal radius, so "Add hole" etc. are unaffected. Defaults (reset every session): coplanar on, equal radius on, coaxial off (it would change features of different sizes). Resize hole therefore resizes all equal holes together by default; click the chip to turn that off.
8. **Move hole / boss with equal radius on** moves all the clones by the same vector.
9. **Top bar layout** wraps to two rows on narrow windows; tool buttons sit below it. Purely a placeholder until you decide the GUI.
10. **Double-click an edge** selects its smooth chain (rim or outline), Ctrl+double-click adds (change the modifier if you prefer).
11. **Resize fillet / chamfer** read the round from the face itself (remove + re-round), per your "no history, smart re-edit" decision; chamfers are re-made with equal legs. Variable-radius fillets are not supported and give a message.
12. **Edit last** only works until another change is made (then the previous operation is frozen), as decided in research section 10.
13. **Combine STEP** places the other file at its own origin (no placement UI yet).
14. **Tools missing a selection helper:** Center between faces needs the hole selected first, then the two faces (selection order matters; shift/ctrl-click keeps order).

## Owner answers (2026-10-18)

- Sketch persistence: start without it (sketches are not kept after they close), add later if needed.
- Sketching problem found: after exiting a sketch no wire edges or faces were left to extrude or push/pull. Other modelers make selectable faces from the closed regions of a sketch, and some allow overlapping wires. Decision pending on the owner's side: overlapping regions make sketching faster but the resulting selections can be cumbersome, so if regions follow suit there must be a fast zone-selection method. Folded into S30.
- Tool GUI and the whole GUI will change; the owner has no plan yet. A research proposal is being written (docs/research/gui-plan.md); the layout rework is session S34. Open question there: keep tools hidden but discoverable, and whether the command search stays.
- Not-built list (entry 6): the stretch spike is S36; projection constraints, horizontal and vertical distance dimensions and sketch corner fillets are in S30. Sketch trim and extend are built.
- Relationship chips are unclear to the owner. Until contributors can judge, follow industry practice and research; the work is S35.
- Moving one bracket hole moves all four (equal-radius rule on). May be right design intent, but the user needs a choice per operation. Hole centres should be measurable, selectable and usable as move handles and dimension anchors (S35).
- The placeholder top bar needs a full rework with the rest of the UI (S34).
- Edge chains: double-click chain is liked. Wanted: select all edges of a face, the coplanar edge loop of a face, and two edges plus double-click for the shared face's loop (S31).
- Variable-radius fillets and chamfers are wanted if possible, with a per-edge choice of variable or not while editing (S37).
- Combine STEP placing the other file at its own origin is fine for now; revisit if it becomes a problem.
- Wanted: pick several solids, move them singly or as a group, and hide them (added to S29). Also a see-through mode where hidden edges can still be picked, after research on how other modelers do it (S38).
- Entry 14 was unclear to the owner: Center between faces needs the hole picked first, then the two faces. Proposed fix: detect which pick is the hole by its type so order does not matter (to be done with S35).

## GUI plan answers (2026-10-18)

Replies to the open questions in docs/research/gui-plan.md; the decisions are recorded in the S34 row of docs/progress.md.

- Fixed strip, permanent search, labels with icons, no radial menu, create tools when nothing is selected, drawer replaces the left list, dark only.
- Icons: review all of them; procedural generation is fine for now; follow solid-modeling conventions.
- Tool-usage tracking is wanted for GUI planning, included in the diagnostics report, declared in the docs and shown in the report preview (S39). Remove it if testers object.
- Tablet: accommodate while cheap, otherwise desktop only.
- Keyboard safety: the owner dislikes programs where typing into the wrong window fires many two-key shortcuts. A research proposal is being written (docs/research/shortcut-policy.md); the work is S40.
- Keyboard rule from the owner: bare keys are fine if they do not immediately alter the model or global application settings, and every hotkey must be user-redefinable. The research draft was stricter on tool starts; to be reconciled in S40. Answered: view toggles such as perspective/ortho are view state, so bare keys are fine.


## Unattended session 2026-10-18 (queue decisions)

15. **Variable fillet editing (S37):** Resize fillet now accepts variable fillets too (any non-planar neighbour-tangent face) and has an "end radius": 0 keeps or makes the fillet constant, above 0 makes it variable (radius at the edge's first vertex, then the end radius at its last). The per-edge choice is made by selecting that fillet's face, since each edge's round is its own face. The tool cannot tell you the existing radii, so type both values. If you want a per-edge list inside one form, that needs a dynamic parameter form (not built).
16. **Variable chamfer:** the modeling kernel offers no variable-distance chamfer, only two distances (already a tool). Not built; decided by what the kernel allows.
17. **Hole centres (S35):** a hole or boss is selected through its wall face, and that face now reports its centre (middle of the axis) and gives centre-to-centre distance for two holes and centre-to-face distance for a hole and a flat face, each with an on-screen dimension. I did not add a separate "centre point" item that can be picked on its own: it would be a fourth selection kind touching picking, highlighting and every tool. Selecting the hole face already works as the move handle (Move hole). Say if you want true pickable centre points.
18. **Center between faces** now accepts the hole and the two faces in any order (it finds the single cylinder among the three).
19. **Array along path** replaces the single-edge array: same tool id, now takes one or more connected edges and spaces copies by arc length (closed paths spread evenly). Copies are translated, not rotated along the path.
20. **One hole or all matching holes (S35):** the relationship chips now read "+ Add 3 equal radius faces" / "✔ With 3 equal radius faces" with a tooltip saying what a click does, and "equal radius" starts off, so moving, resizing or filling a hole changes only the one you picked. Click the chip to include its twins. Coplanar stays on by default (push/pull of a flat face with its coplanar faces is the common case). To restore the old default, set `equal_radius: true` in `ruleOn` in app/src/main.ts. A per-tool default (for example resize all, move one) is not built.

## Four-agent wave (2026-10-18)

21. **Sketch snaps add constraints (S30):** snapping onto a curve or midpoint now adds a point-on or midpoint constraint, and automatic tangency applies to the circle tool only. Change: drop the `on` handling in `pointFor` in `sketch.ts`. Open: should snaps always add constraints (now yes)?
22. **Unwrap (S33):** exact for cylinders (developable surfaces map with true lengths and areas). Spheres, tori and free-form faces cannot unroll without distortion; tell me what accuracy you want before they are tried. The unrolled sketch hides extrude and revolve (flag `flat` in `renderPanel`, `sketch.ts`).
23. **Reference points (S27):** "plane crossings" is read as where an axis meets the sketch or face plane; axes are visible by default. The picker does not yet snap to model vertices or edges, and sketches snap to axis points only, not axis lines.
24. **Selection settings (S26):** default pick range 5 px for edges and 8 px for points; box select picks the kind already selected (edges when nothing is), left to right encloses and right to left touches; measure mode moved from right-click to the M key. Change the numbers in `settings.ts`.
25. **See-through (S38):** X toggles a 30% opaque surface with hidden edges and faces pickable; repeated clicks cycle the faces behind. The comparison with other modelers came from general knowledge, not a web search.
26. **Edge selection (S31):** ring, sharp edges (30 degree default, change `angle` in `selectionHelpers` in `main.ts`) and region outline. No angle slider yet. Open: offset of inner loops and dragging the divide edge.
27. **Hole centre dots (S35):** a centre is an alternate pick target for the hole face rather than a new selection kind (a real point kind would need ids through every tool; change `nearestCentre` in `viewport.ts`). Per-tool defaults for what a tool applies to are parked.
28. **Eyedropper (S32):** values are matched by field name (see the watchlist). Not hand-checked on a fillet.
29. **Keyboard policy (S40):** bare keys may change the view, display, arm a tool or change selection; anything that changes the model or a setting at once needs Ctrl or Alt. Bare keys need the pointer over the view (1.5 s grace), there is a single-key off switch, no sequences, undo and redo are blocked during a live drag or typed entry, and browser keys, Escape, Enter, Tab, Backspace, Delete, Space and Ctrl+Alt are reserved. Open: should sketch keys move under the router; M (measure) is still handled in `viewport.ts` and cannot be rebound; the unsaved-work warning and touch and browser-key audits are not done.
30. **Usage tracking (S39):** counts live in core memory only (nothing persists) and add a `drag` surface beside strip, search, drawer and keys. Sketch tools are not counted. To remove it, see the header of `usage.py`.
31. **Dimension leaders (S13):** where labels would overlap, the first is kept and later ones are dropped (the panel still lists them). Promoting a panel row to the on-model leader was skipped as optional. Please check label placement on a few more models.
32. **Kernel closeouts:** parked ellipse and spline sketch curves (the solver has none), project curves onto faces, and groups, layers and colours (a document model change); schedule any of them as new sessions. S25 closed as not reproducible in the kernel. S37: variable per edge in one form needs a dynamic form (add a per-edge radius list parameter kind and render it).
33. **Merge fixes:** `sketch.ts` held two Latin-1 characters (degree and multiplication signs) that broke the dev server; both are now UTF-8. The X see-through key was re-added as a router command (`display.seeThrough`) when the key router replaced the old key handler.

34. **Separate bodies by default (S29, core):** primitives take `new_body` (1 = own body, the default; 0 = fuse), and sketch extrude and revolve accept mode `new`, the server default when the client sends none. Boss, arrays and push/pull still join (they are features of a body). The sketch UI default stays Join because extruding a sketch drawn on a face usually means to add to it; to default the UI to a new body, change the initial `mode` in `sketch.ts` (two places). `new_body` is a number box until a boolean parameter kind exists (after S34). Open: move, rotate and scale still act on the whole model; you want single and group moves, so a per-body selection for them is the next piece.
35. **Per-tool "applies to" defaults (S35):** saved per tool in the browser. Resize hole also resizes same-size holes by default; every other tool is off, so one hole still moves alone. Change `TOOL_RULES` and `ruleFor` in `main.ts`. Owner decision 2026-10-18: keep this default for now; recorded in docs/watchlist.md with the proposed fix.
36. **Picking additions (S26, S30, S35):** Alt+click cycles through all faces under the pointer, including hidden ones; a fast multi-zone pick is box select with Box selects set to Faces; the settings window has a kind switch (Auto, Edges, Faces, Vertices); hole centre dots drag to move the hole (checked in Chrome). Not hand-checked: per-tool chip behaviour, the inset loop in the UI, the sharp-edge slider and the kind switch.
37. **Fillet per edge (S37):** a new tool with a start and end radius per selected edge (end 0 or equal to start is constant, start 0 leaves the edge sharp), instead of changing Variable fillet, so the old tool keeps its simple form. If you want one tool, fold Variable fillet into this one.
38. **Sketch keys under the router (S40):** undo (Ctrl+Z), Escape, Enter and Delete or Backspace are fixed keys that cannot be rebound. Escape works without the pointer over the view (cancel is harmless); Enter and Delete need it; editing keys ignore the single-key off switch. A warning appears when leaving with unsaved edits or an open sketch; there is no confirmation yet when opening a file over unsaved edits. Open: is the leaving warning too eager now that autosave exists? Should hide, isolate and see-through get visible buttons (S34)? M (measure) stays in `viewport.ts` because it only acts during a tool drag.
39. **Unwrap beyond cylinders (S33):** regions that cross the seam of a closed cylinder or cone become two faces; outlines are interpolated curves; a chain of faces uses arc length, so folds without tangency also unroll (add a tangency check in `_strip_unrolling` if you want only tangent chains). The button is now Sketch on unrolled faces. Cone and chain paths are unit-tested only. Open: pushing or pulling the wrapped faces, kept sketches.
40. **Sketch tangency and snaps (S30, S27):** the arc tangency tolerance is 2 x `AUTO_AXIS_DEG` (change in `addArc` in `sketch.ts`); snaps still add constraints (entry 21); the sketch snap to an in-plane axis line adds no constraint (to add one, create a reference line entity for each in-plane axis in `start`); the point picker also snaps to model vertices and points on edges.
41. **Owner decisions on the alpha notice and releases (2026-10-18):** the alpha notice should be acknowledged once per user, covering every release (planned as S42; the earlier "every launch" rule is replaced); no portable-mode marker for now. Autosave safety with several running copies is planned as S41. Both ideas and the proposed fixes for several releases sharing one data folder are in docs/watchlist.md.
