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
