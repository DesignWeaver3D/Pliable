# Questions for the user (overnight session, 2026-10-17)

Decisions were made with this order: your described workflow, industry standard, common practice in other direct modelers, web consensus. Each entry: what I decided, why, and what to change if you disagree. Development did not stop for any of these.

1. **Orthographic mode** (resolved): now a true orthographic camera, the usual convention. It was a narrow-FOV perspective camera before.
2. **View keys:** Number keys for standard views (0 iso, 1 front, 2 top, 3 right, 4 rear, 5 bottom, 6 left), P toggles perspective/orthographic, V looks at the selected face (mean normal for curved faces; wrap-around faces such as a full cylinder use the direction from the model centre).
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
