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

- **The selection carries over onto the result of a drag.** After a fillet or chamfer, the new round faces stay selected (strong orange, listed in the selected readout) until you click elsewhere. This is deliberate, so a result can be tweaked or undone, and the owner chose to keep it. *Symptom if it is really a bug:* faces drawn orange while the readout says nothing is selected. Suspect the faint related-faces highlight, which keeps the old selection's face ids until the core replies (`setRelated` in `app/src/viewport.ts`, `setSelection` in `app/src/main.ts`).

## Research sources

- **The command inventory is a snapshot.** The local research note docs/research/command-inventory.md is based on a published command list for one version of another program; newer versions have more commands, and the Pliable status column was read from `progress.md` and `features.py`, not tested tool by tool.

## Frontend structure

- **`layout.ts` is the only place tools are grouped.** Tools not listed there appear under "Other". If a tool is missing from the list, it is probably not accepted for the current selection (the button is disabled, not hidden).
- **Tool availability is computed from the selection plus the related-face chips,** so changing a chip can enable or disable buttons.
- **Keyboard shortcuts are ignored while typing in an input** (the tool form, the dimension prompt). If a shortcut does nothing, check where focus is.

- **2026-10-17:** View-at-face (V) on curved faces uses the area-weighted mean triangle normal; wrap-around cylinder/cone faces look along their axis from the camera's current side (axis found from the normals' covariance, tolerance 0.05); other wrap-around faces (sphere, torus) fall back to model-centre-to-face-centre, which can be wrong for off-centre features.

- **S18 push/pull on multi-solid files:** only the containing solid is booleaned; faces on different solids in one selection are refused. Faces in open shells (not part of a closed solid) are refused with a message. Overlap between separate solids is not resolved: pushing into a neighbouring solid leaves both solids overlapping.
- **S18 UnifySameDomain fallback:** on very detailed solids (about 2,000+ faces) merging coplanar faces can produce invalid geometry. Push/pull then keeps the plain boolean result, so coplanar faces may stay split.
- **S18 generic error translation:** any non-Operation exception in a tool becomes "<Tool> failed on this geometry (...)". Only a handful of OpenCASCADE exception names have friendly text; the rest show the first line of the raw message.
- **S18 import repair:** only solids with negative volume are repaired (ShapeFix_Solid); open shells and invalid solids are reported in the status line, not fixed. No file with an inside-out solid was available to test the repair path.

- **S18 surface-body healing:** closed surface bodies are made into solids; open ones are tried with ShapeFix_Shell and sewing at 1e-3 mm, and otherwise left as they are and named in the import warning. Missing faces are never invented. Part names come from the STEP file as OpenCASCADE decoded them, so non-Latin names can show as garbage. Loose faces that are not in any shell are not checked. Import takes a few seconds longer from the healing and checks.
- **Open surfaces are not drawn differently yet:** they render like solids. Highlighting free edges or ghosting them is not built.
- **S20 busy indicator:** shown after 400 ms for any request not on a quiet list (previews, sketch solves, lookups) in `app/src/client.ts`; it shows elapsed seconds only, with no real progress or cancel (OpenCASCADE gives no progress). Websocket keepalive pings are off (`ping_interval=None`) so a long operation holding the GIL cannot get the local connection dropped. Confirmed by the user on a slow AD5M STEP import.
- **OPEN DECISION, future release: how to work with multi-solid STEP files.** Assemblies and multi-body files (for example the AD5M ones) import and display, but in practice you can only select faces and edges to read measurements; the modeling tools do little or nothing useful on them. Needs investigation and a decision on the model: per-body selection and visibility, treating bodies as separate parts, moving or hiding bodies, and what push/pull, fillet and combine should do across bodies. Not scheduled; see also the S18 entry above.
- **S21 diagnostics scrubbing:** log lines are reduced by a regex (`diagnostics.py`, `scrub`): paths become base names and the account name is replaced. *Symptom:* a path with spaces, or a name inside other text, could slip through; the dialog shows the text before copying so the user can check. The browser user-agent string is included as is. Not checked against a real tester's machine.
- **S21b open-body loops:** flat loops are detected with `BRepBuilderAPI_FindPlane` at 1e-3 mm on the closed wires from `ShapeAnalysis_FreeBounds`. Loops that do not close are not counted. Run on the AD5M files: Frame has 2 open bodies, each 4 loops with 3 flat; Enclosure has 6, e.g. 4 loops/3 flat (twice), 1/1, 1/0. So most open loops are flat and hole-capping would likely close many but not all of them (the 4-loop bodies keep one non-flat loop).
- **License notices (S21):** `THIRD_PARTY_NOTICES.md` was written from memory of each project's license, not read from the packages; verify before the first release.
- **Dev metrics hidden (2026-10-17):** triangle counts and the latency readout show only with `?dev=1` in the URL. *Open follow-ups:* tighten tessellation deflection when zoomed in or for small models while keeping drag previews coarse (touches the S1 speed work); check that sketch arcs and circles are drawn with enough segments; add mesh stats and timings to Copy diagnostics.

## Resolved

- **2026-10-17:** Orthographic mode used a narrow-FOV perspective camera. Now a true orthographic camera.
- **2026-10-17:** Sketch mode stayed active and swallowed all clicks, so faces could not be selected. Escape now exits it.

- **S17 portable build (2026-10-17):** only the Windows build was produced and smoke-tested locally; the macOS/Linux jobs in `.github/workflows/release.yml` have never run (the `macos-13` runner label and `--collect-all` lists may need fixing on first run). Bundle is ~360 MB (OCP). The launcher exits 20 s after the last tab disconnects (`IDLE_EXIT_SECONDS`), so a laptop sleeping with the tab open may close the app. The smoke test does not cover the GUI, the browser opening or SmartScreen/Gatekeeper. The packaged app serves HTTP on 127.0.0.1 only. Dev machines: a running `pliable-server` locks `core/.venv`; build in a separate env via `UV_PROJECT_ENVIRONMENT`.
- Hide/isolate is view-only: the frontend filters the mesh by solid number; hidden bodies are still affected by whole-model tools (mirror, arrays, offset) and are included in exports. Solid numbers follow the explorer order of the current shape, so they can change after an operation; the hidden set is dropped for numbers that no longer exist.
- Sketch polygons (S23) are lines with equal-side constraints only; dragging a corner can skew them. Not yet exercised in a browser (type-checked only).
- Patch fill (S24): tangent (G1) is attempted only where an edge has one neighbouring face; if OCC cannot build it (e.g. a perpendicular wall) it silently retries as G0. G2 is not attempted.
- Do not use `BRepFill.Face_s` (OCP): after calling it on edges of a sewn open box, later fillets of unrelated shapes in the same process returned invalid geometry (reproduced in a script, cause not found). Bridge uses ruled ThruSections instead. Theory: it leaves global or shared geometry modified; try `BRepFill_Generator` if a direct ruled face is needed.
- Sketch trim (S23): lines only, crossings with other lines and circles; arcs cannot be trimmed or serve as a trim boundary. Trimmed line loses its constraints. Crossings are not added as constraints, so trimmed ends are free points.
- Sketch extend (S23): lines only, stretches the end nearest the click to the first line or circle beyond it; arcs are neither extended nor targets. The line loses its constraints, the new end is a free point (not constrained to the target). Checked with a throwaway script and a type check; not yet exercised in a browser, and there is no frontend test runner.
