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
- Usage tracking (S39, planned): counts of tool use travel only inside the diagnostics report the user copies or sends, never automatically. It must stay declared in the docs and shown in the report preview; remove it if testers object.
- Tablet and touch (S34, planned): the GUI accommodates touch only while it stays cheap; the right-click measure mode, hover highlights and the keyboard-only paths have no touch equivalent yet.

## Sketch regions (2026-10-18)

- **Regions come only from closed loops** (`sketch.regions`). Open lines that cross a loop or end on it (T-junctions) do not divide it. *Symptom:* a dividing line drawn across a rectangle leaves one face. Loops that share points and cross each other can also fail to split.
- **A zone is imprinted only when it lies inside one flat model face** (`sketch._host_face`); a zone that sticks out past the face edge becomes a loose face over the model instead of splitting it. *Symptom:* a double face on part of the model; delete the loose face.
- **Loose sketch faces are not solids:** they show and pick like faces, push/pull makes a solid from them (negative distance cuts when it overlaps material), STEP export writes them as faces. Other tools may refuse them.
- **Sketches are not kept after Finish sketch,** only the faces (decision: sketches are not stored for now). Discard sketch or Escape leaves nothing.
- **Rectangle corner options** (`sketch.ts`, `addRectangle`): the fillet or bevel size is clamped to just under half the shorter side, and the rubber-band preview while placing still shows square corners. Rounded rectangles do not reuse snapped corner points (new points are made), and bevels get no constraints beyond the four sides. *Symptom:* a snapped rounded rectangle is not joined to the point it was snapped to.

## Edge selection helpers (2026-10-18)

- **"Edge loops" selects every boundary loop of the face** (outline and hole loops together), not only the coplanar outer loop; "All edges" gives the same ids for a face (`edgesel.py`). *Symptom:* a face with holes selects the hole rims too; shift-click to drop them.
- **Shared-loop double-click** takes the first other selected edge as the partner, so with three or more edges selected the partner is the first in the list. With no common face it falls back to the smooth chain. Not seen in a browser: only the face buttons were exercised.

## Fillet editing (2026-10-18)

- **Resize fillet on a variable fillet** (`features.ResizeFillet`): the start/end radii map to the sharp edge's first/last vertex as the kernel orders them, which may be the opposite of how the fillet was first made, and the tool does not show the old radii. *Symptom:* the fillet comes back mirrored; swap the two radii. It now also offers itself on any non-planar face, so it can be offered on faces that are not fillets (it then says so when run).

## Hole centres (2026-10-18)

- **A hole centre is the middle of the full cylinder's axis** (`measure.hole_centre`); partial cylinders (fillets) have none. Centre distance between two holes is the straight distance between those points, not the distance between parallel axes. *Symptom:* two holes at different depths report a larger distance than their axis spacing.
- **Centre between faces** treats the single cylinder among the three picks as the hole; picking two cylinders and one plane is refused.

## Sketch offset (2026-10-18)

- **Offset curve** (`sketch.offset_entities`, panel button "Offset" with a distance box when curves are selected): copies are plain geometry with no constraints, so they do not follow the original; a closed outline offset outward gets rounded corners. A selection of open curves offsets to the left of the drawing direction, and splines are not supported (the sketch has none). *Symptom:* an offset that "points the wrong way" on an open chain: use a negative distance.

## Inset face outline

- Only the outer loop is offset; hole loops are left alone. Corners use sharp (intersection) joins, so concave corners can self-intersect on large insets and report an error.

## Divide face

- The dividing edge is parallel to a face axis only (the face's local x or y), not at an arbitrary angle, and is set by a number, not by dragging in the viewport.

## Sketch corner round

- Works only where exactly two straight lines meet at a point; corners involving arcs or circles report a message. The tangent constraints keep the arc on both lines, but dimension constraints on the old corner point are dropped.

## Sketch projection

- Only lines, and circles or arcs whose axis is square to the plane, project. Tilted circles (ellipses), splines and edges square to the plane are skipped without a message. The projection is a snapshot: it does not follow later model changes.

## Sketch snapping to curves

- A point placed on a curve or midpoint by snapping is not tied to it with a constraint, so moving the curve later leaves the point behind. Alignment guides snap to points only (not to circle centres' tangent directions or curve ends), and the snap radius is the same 10 px as point snapping.

## Live sketch measurements

- The tag is read-only: typing a value to place the shape exactly is not built. No tag for arcs yet, and values are rounded to 2 decimals.

## Construction planes

- Only offsets of the three world planes are offered. No plane through three points, at an angle, or midway between faces; the offset is typed, not dragged.
- **S25 merge cost:** `unify_result` runs after every tool; measured 0.4 s on a 231-face plate with 225 holes, and it grows with face count. If large models feel slow, merge only faces near the changed region. Out-and-back and all-tools sweeps (`core/tests/test_seams.py`) found no leftover seams on the bracket.

## Selection settings, box select and see-through (S26, S38)

- Pick ranges (edge 5 px, point 8 px) are stored in the browser only and are not part of the document; the old fixed values were 6 and 9.
- Box selection picks one kind: the kind already selected, otherwise edges. Face window/crossing tests use the face's projected bounding box, so a crossing box can catch a face it only passes near; visibility is tested with one ray per item (edge midpoint, first triangle of a face).
- Measure mode during a drag moved from right-click to the M key; right-drag now orbits mid-drag, so the drag distance shifts if the view moves under the pointer.
- See-through draws the surface at 30 percent opacity and ignores depth for edges. Clicking the same spot again cycles through faces behind; hidden vertices and edges are picked by screen distance only.

## Edge selection methods (S31)

- Edge ring only follows four-sided faces with one outline loop and stops at any other face; sharp-edge selection uses a fixed 30 degree threshold and connects through shared vertices only (no angle setting in the UI yet).
- Region outline counts an edge once if it borders exactly one selected face, so it also picks edges where the model's own boundary is open.

## Hole centres as pick targets (S35)

- A hole or boss centre is a small blue dot; clicking it selects that hole's face (it is not a separate point selection). Using a centre as a drag handle to move the hole is not built; the Move hole tool form is used instead. Centre markers are hidden when the hole wall is in the way.

## Eyedropper (S32)

- The eyedropper button sits next to length and angle fields in tool forms. It reads the measurement of the clicked face or edge: radius, diameter and length by matching the field name (names containing "radius" or "diam", else length, distance, then radius); angle fields read an Angle row. Other field names get a length, which may not be what was meant. It picks against the committed model, so the preview is hidden while it is armed.

## Tool-usage counts

- **Counts live in core memory only** (`usage.py`, `Session.usage`) and reset when the core restarts or the client reconnects; they are not saved to disk. Surfaces are what the client reports (`strip`, `search`, `drawer`, `keys`, `drag`, `other`). A drag with an armed tool counts one start (at arming), a direct drag counts one start with surface `drag`. Sketch tools and view commands are not counted yet. *Symptom:* usage numbers that look low after a restart, or no entry for sketch tools.

## Keyboard shortcuts

- **Bare keys need an engaged viewport** (`keys.ts` `Engagement`, `ENGAGE_GRACE_MS = 1500`): pointer over the 3D view, a recent exit, or a click in it; a click elsewhere, a text field or window blur drops it. *Symptom:* a view key that does nothing right after using a panel (move the pointer into the view), plus the status hint.
- **Shortcut rules are only enforced at assignment and load** (`validateBinding`, `Keymap.fromJson`); the sketch keeps its own key handling (Delete, Escape, tool letters in `sketch.ts`) and is not yet under the router. *Symptom:* a sketch key that ignores the single-key switch or the engagement rule.
- **Digit view keys ignore Shift** so top-row digits work on layouts that need Shift for digits; `Shift+1` therefore also runs view 1. Only the first chord is shown as the hint, and rebinding a command replaces all its chords (the numpad alias is lost).
- **Not built yet:** unsaved-work warning on closing the tab, confirmation dialogs (no model command has a bare key, so none is needed today), touch equivalents audit.

## Dimension leaders

- **Overlap avoidance is a text-box guess** (`dimensions.ts`, `overlaps`): width is estimated from the character count and rotated text uses its unrotated box. The first dimension drawn wins and a later one whose text would overlap is left out entirely (the panel still lists it). *Symptom:* a dimension that vanishes when two labels are close, or labels that still touch.

## Sketch tangency and snap constraints (agent/sketch)

- **Circle tangency is built in the solver from a hidden touching point** (`_Solver._circle_tangent`): point on both curves plus a perpendicular or collinear helper line. Tangent to a circle does not pick internal or external touching; the starting geometry decides. *Symptom:* a circle flips to the other side of a line while solving a badly placed sketch.
- **Auto tangency only while drawing a circle:** the radius snaps to a line, circle or arc within the snap distance and a tangent constraint is added. Lines and arcs do not get automatic tangency yet.
- **Snapping onto a curve or a line midpoint now adds a point-on or midpoint constraint** to the new point. *Symptom:* a corner dragged off a line it was snapped to stays on that line; delete the constraint to free it.

## Reference geometry and snaps (S27, agent/sketch)

- **Axes are drawn to 1.25 times the model's largest coordinate** (at least 25 mm each way) and follow the model size only when a new mesh arrives. Axis lines are depth-tested, so the model hides the part inside it.
- **The point picker snaps within 12 px** to the origin, to the face centre and to where an axis meets the plane of the face under the cursor (which can lie outside the face), and within 6 px to a point along an axis. Curved faces offer no face centre or plane crossing (no single plane). Edges and vertices of the model are not snap targets in the picker yet.
- **Placement tools declare `placement`** (three parameter names) in `tools.py`; only the primitives and the circular hole pattern set it. Other tools that take a point (linear array vector, move) are not covered.
- **Sketch reference points:** every sketch gets fixed points at the projected origin and where each axis meets the plane, and a face sketch also gets the face centre. They are fixed lone points (never removed as orphans); they appear in every sketch even if far from the model.

## Unrolled cylinder sketching (S33 spike, agent/sketch)

- **Only cylinder faces unroll** (`unwrap.py`). Cones, spheres, tori, free-form faces and several faces at once are refused. A cylinder face that spans the seam (a full tube) is unrolled from its angle range, so regions crossing the seam are not tested.
- **Outlines map as 48-point interpolated curves**, not exact ellipses or helices; lines and regions are exact in size (checked by area). *Symptom:* a circle on a small cylinder imprints with a slightly different outline than a true curve.
- **The unrolled sketch has no extrude, revolve or model-edge projection**; finishing only imprints regions onto the cylinder face. Sketches are not kept.

## Fillet per edge

- **Rows are labelled by edge id** (`toolpanel.ts` `perEdgeRows`), not by position or a highlight, so with many edges it is hard to tell which row is which. Per edge a start and end radius: end 0 or equal to start is constant, start 0 leaves the edge sharp. Chamfers cannot be variable (kernel). *Symptom:* the wrong edge rounded after reading the ids; a preview error when edge radii clash at a shared vertex.

## Keyboard audits

- **Sketch keys go through the router but are fixed** (`sketch.undo/cancel/finish/delete` in `keys.ts`; they call `SketchMode.onKey`). Escape works without view engagement, Enter and Delete need it. Sketch editing keys are not switched off by the single-key switch. *Symptom:* Enter or Delete does nothing in a sketch until the pointer is over the view.
- **Leaving the page warns** whenever there are undo steps or a sketch is open (`beforeunload` in `main.ts`); an export does not clear it. No warning when opening another file over edits.
- **Touch gaps (not built):** hide, isolate, show all, look at face and see-through have a key or the search but no visible button. **Browser keys:** Ctrl+K is taken by the search (some browsers use it for their own search box); not tested outside Chrome.
- **M (measure mode) stays in `viewport.ts`**: it only acts during a moved tool drag, where the router is already off (value entry owns the keyboard), so moving it adds nothing.
- **Sketch usage counts** record each drawing tool chosen as `sketch_<tool>` (start) and `sketch_extrude`, `sketch_revolve`, `sketch_finish` (commit); sketch cancels and errors are not counted.
