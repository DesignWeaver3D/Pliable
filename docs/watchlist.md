# Watch list

Known approximations, shortcuts and untested corners. If something behaves strangely, check here first. Each entry says what was assumed, what would show up if it is wrong, and where the code is. Add an entry whenever a shortcut or guess goes in, and mark entries **Resolved** (with the date) rather than deleting them.

Open design questions for the user live in [questions.md](questions.md); this file is for things that may bite.

## Picking and view

- **Pick depth uses distance to the camera position** (`viewport.ts`, `pick`, `nearestVertex`, the edge tests). In orthographic mode the correct depth is along the view direction. *Symptom:* in a crowded area an edge or vertex behind a face is picked, or the front one is missed, in orthographic mode.
- **Edge/vertex visibility slack:** an edge counts as visible if it is within `1% + 12 pixels` of the face depth under the pointer (`depthLimit` in `pick`). *Symptom:* hidden edges just behind a thin face can be picked, or edges on a grazing face can't.
- **Standard top/bottom views tilt the camera by 1e-4** so "up" stays defined (`STANDARD_VIEWS`, `lookFrom`, `alignToFace`). *Symptom:* a top view that is very slightly rotated.
- **Clipping planes follow camera distance** (`fitClipping`: distance/100 to distance*100). *Symptom:* parts clipped when zoomed far in on a large model, or when the target is far from the geometry.
- **Switching projection keeps the apparent size at the target,** so things in front of or behind the target change size. Expected for perspective, but after toggling, the orbit target is what stays put.
- **Escape leaves the sketch** once there is nothing to cancel. *Symptom:* an Escape pressed to dismiss something else drops the sketch.

## Modeling tools

- **Topology ids are not stable across operations.** The model is rebuilt after each edit and faces are renumbered. Anything that stores a face/edge id across an edit (the "Edit last" form, related-face chips) is re-derived, not tracked. *Symptom:* an edit applied to the wrong face after a undo/redo sequence.
- **Holes and bosses are edited by fusing or cutting cylinders** (no feature history). *Symptom:* resizing or moving a hole that was only partly a cylinder (cut by another feature) gives an unexpected shape.
- **Related-face chips:** coplanar and equal radius are on by default, so a single resize can edit many faces at once. Coaxial is off. Matching uses tolerances `LINEAR_TOL = 1e-5`, `ANGULAR_TOL = 1e-6` (`relations.py`). *Symptom:* a face that looks equal is not included (a tolerance miss) or one is included that you did not expect.
- **Resize hole takes a typed diameter,** and 0 means unchanged. The form does not show the current value. *Symptom:* confusion about what the starting value is.
- **Shell, draft, delete face, remove fillet use OCC defeaturing/offset,** which can fail or give a degenerate result on complicated shapes. Shell with too large a thickness is caught by a volume check; other tools may not be. *Symptom:* a tool reports success but the model is unchanged or wrong. Check Model info (validity, volume).
- **UnifySameDomain runs after every operation (`finish`).** It can merge faces you expected to stay separate, or change face ids.
- **Combine STEP** places the other file at its own origin. There is no placement UI yet. *Symptom:* the second body lands in an unexpected spot.
- **Performance:** resizing 400 equal holes took about 3.8 s (batched into one boolean). Larger models or counts will be slower; there is no progress indicator.
- **Edge chain (double-click)** follows edges that continue tangentially (dot product above `1 - 1e-4`). *Symptom:* a rim that stops early at a very slight kink, or a chain that runs on through a very gentle bend.

## Sketching

- **Sketches are not persistent.** They exist only while sketching and are gone after extrude/revolve or exit. Re-editing a sketch after extruding is not possible.
- **The solver is SolveSpace (py-slvs).** It flags redundant and conflicting constraints; redundant ones (for example fixing all three points of an arc) are reported as a conflict rather than silently ignored. *Symptom:* a constraint that "should be fine" being rejected.
- **Horizontal/vertical distance dimensions reorder their two points** to match SolveSpace's sign convention (`sketch.py`). *Symptom:* a dimension that flips the geometry to the other side.
- **Face reference geometry** (outline and hole centres of the face you sketch on) is fixed, and cannot be moved or deleted. Edges that are not on the face (the model's other edges) are not projected yet.
- **Ctrl+Z inside a sketch undoes the sketch step, not the model** (the model undo is ignored while sketching).
- **Sketch dimensions in the SVG overlay redraw every frame.** Cheap for a few dimensions; not tested with hundreds.
- **Extrude with several nested loops** makes inner loops holes; loops that cross each other are not checked and may give an invalid face. *Symptom:* an extrude error or an empty result.

## Frontend structure

- **`layout.ts` is the only place tools are grouped.** Tools not listed there appear under "Other". If a tool is missing from the list, it is probably not accepted for the current selection (the button is disabled, not hidden).
- **Tool availability is computed from the selection plus the related-face chips,** so changing a chip can enable or disable buttons.
- **Keyboard shortcuts are ignored while typing in an input** (the tool form, the dimension prompt). If a shortcut does nothing, check where focus is.

- **2026-10-17:** View-at-face (V) on curved faces uses the area-weighted mean triangle normal; wrap-around cylinder/cone faces look along their axis from the camera's current side (axis found from the normals' covariance, tolerance 0.05); other wrap-around faces (sphere, torus) fall back to model-centre-to-face-centre, which can be wrong for off-centre features.

## Resolved

- **2026-10-17:** Orthographic mode used a narrow-FOV perspective camera. Now a true orthographic camera.
- **2026-10-17:** Sketch mode stayed active and swallowed all clicks, so faces could not be selected. Escape now exits it.
