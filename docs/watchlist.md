# Watch list

Known approximations, shortcuts and untested corners. If something behaves strangely, check here first. Each entry says what was assumed, what shows up if it is wrong, and where the code is. Add an entry whenever a shortcut or guess goes in; delete an entry when it is fixed (the git log keeps it). Design questions for the owner live in [questions.md](questions.md).

## View and picking

- Pick depth uses distance to the camera position (`viewport.ts` `pick`, `nearestVertex`); in orthographic mode the right depth is along the view direction. Symptom: a hidden edge or vertex is picked in a crowded area.
- Edges and vertices count as visible within `1% + 12 px` of the face depth under the pointer (`depthLimit`). Symptom: edges just behind thin faces are pickable, or edges on grazing faces are not.
- Standard top/bottom views tilt the camera by 1e-4; clipping planes follow camera distance (`fitClipping`); switching projection keeps the apparent size at the orbit target.
- View at face (V): curved faces use the area-weighted mean normal; wrap-around cylinders and cones look along their axis from the camera's side; spheres and tori fall back to model centre to face centre, wrong for off-centre features.
- Settings: pick ranges are stored in the browser only, not in the document.
- Dev metrics (triangle counts, latency) show only with `?dev=1`. Follow-ups: tighter tessellation when zoomed in, enough segments on sketch arcs, mesh stats in Copy diagnostics.
- The selection carries over onto a drag's result on purpose (the new round faces stay selected). If faces show orange while nothing is selected, suspect `setRelated` in `viewport.ts`.
- Axes are drawn to 1.25 times the largest model coordinate (at least 25 mm) and resize only when a new mesh arrives; they are depth-tested.
- Open surfaces render like solids; free edges are not highlighted.
- Hide/isolate is view-only: hidden bodies still feed whole-model tools and exports. Solid numbers follow explorer order and can change after an operation (the hidden set drops numbers that vanish).

## Selection

- Box select samples visibility (up to 6 points per edge, 12 triangle centres per face) against the whole model: a thin sliver can be missed, large models will lag. Window needs every triangle of a face inside. The "window selects items not enclosed" report was fixed by rewrite, not by a confirmed root cause (`boxselect.ts`). Box select starts from the model only with Ctrl or from empty space.
- Edge ring over a face with more than four edges takes the farthest parallel straight edge and stops at faces with holes. Region outline counts an edge once if it borders exactly one selected face, so it also picks edges at open model boundaries.
- Edge loops of a face select every boundary loop (outline and holes). Shared-loop double-click uses the first other selected edge as partner and falls back to the smooth chain (tangent within `1 - 1e-4`).
- Hole and boss centres are blue dots that select the hole face; centres hide when the hole wall is in the way. A hole centre is the middle of the full cylinder's axis (`measure.hole_centre`); partial cylinders have none. Centre distance is the straight distance, so holes at different depths read larger than their axis spacing.
- Divide face drag: with the form open, pressing on the model places the dividing line instead of selecting (Cancel first). Orientation comes from the first 4 px; the line is parallel to a face axis only.
- Related-face chips match with `LINEAR_TOL = 1e-5`, `ANGULAR_TOL = 1e-6` (`relations.py`); per-tool defaults are `TOOL_RULES` in `main.ts` and saved per tool in the browser.
- Measure mode (M during a drag) shifts the drag distance if the view moves under the pointer.
- Eyedropper picks against the committed model (the preview is hidden while armed) and reads values by field name: names containing "radius" or "diam", else length/distance, else radius; angle fields read an Angle row. Other names get a length.

## Modeling

- Topology ids change after each operation; anything that keeps an id across edits (Edit last, chips) is re-derived. Symptom: an edit lands on the wrong face after undo/redo.
- Holes and bosses are edited by fusing or cutting cylinders; a hole partly cut by another feature resizes oddly. Resize hole takes a typed diameter and does not show the current one.
- Shell, draft, delete face and remove fillet use OpenCASCADE defeaturing/offset, which can fail or give degenerate results; only shell has a volume check. Check Model info when a tool reports success but nothing changed.
- `UnifySameDomain` runs after every tool and may merge faces you wanted separate or renumber them. Measured 0.4 s on a 231-face plate and it grows with face count (merge only near the change if large models feel slow). On very detailed solids (~2,000+ faces) it can produce invalid geometry; push/pull then keeps the plain boolean result.
- Push/pull on multi-solid files booleans only the containing solid; faces on different solids, or in open shells, are refused. Overlap between separate solids is not resolved. Bodies that end up overlapping are not fused or checked.
- Per-body rotate and scale pivot about the model origin, so a scaled body also drifts.
- Resize fillet on a variable fillet maps start/end radii to the kernel's edge ends, which may mirror the original; it offers itself on any non-planar face and says so when it is not a fillet. Fillet per edge labels rows by edge id (hard to match with many edges); start 0 leaves an edge sharp; clashing radii at a shared vertex fail the preview.
- Inset face offsets the outer loop or one inner loop (`loop` number, order as the face reports) with sharp joins; concave corners self-intersect on large insets.
- Resize hole also resizes same-size holes by default (owner chose this); moving a hole still moves one. Fix if reported: default off, or a hint on the chip.
- Emboss/Cut along surface takes a form distance (no drag) and fails where the offset fails (tight curvature, distance beyond the radius of curvature).
- Array tools fuse copies with the original (max 200); arrays act on the whole solid today (S49).
- Combine STEP places the file at its own origin. Mesh exports use a 0.01 mm chord tolerance.
- Patch fill tries tangent (G1) only where an edge has one neighbouring face and silently falls back to G0. Do not use `BRepFill.Face_s`: afterwards, fillets of unrelated shapes in the same process returned invalid geometry (cause unknown); bridge uses ruled ThruSections.
- Import repair fixes only negative-volume solids (`ShapeFix_Solid`); closed surface bodies become solids; open ones get `ShapeFix_Shell` and sewing at 1e-3 mm, else are named in the import warning. Part names from STEP can show as garbage for non-Latin text. Loose faces outside any shell are not checked.
- Any non-Operation exception becomes "<Tool> failed on this geometry (...)"; only a handful of OpenCASCADE exceptions have friendly text.
- Open decision, future release: how to work with multi-solid STEP assemblies (per-body selection and visibility, separate parts, what push/pull, fillet and combine do across bodies).
- Performance: resizing 400 equal holes took about 3.8 s (one boolean); no real progress, only the busy spinner.

## Sketching

- The solver is SolveSpace (py-slvs). Redundant constraints are reported as conflicts rather than ignored. Horizontal/vertical distance dimensions reorder their points for its sign convention. Circle tangency uses a hidden touching point and does not choose internal or external; a badly placed sketch can flip sides.
- Sketches are not kept after Finish sketch (only faces remain). Regions come only from closed loops: an open line across a loop does not divide it. A zone is imprinted only when inside one flat face; one sticking out becomes a loose face over the model (delete it). Loose faces are not solids; push/pull makes one (negative cuts), and STEP export writes faces.
- Face outline and hole centres are fixed reference geometry. Every sketch also gets fixed points at the origin, axis crossings and face centre.
- Projection of model edges is a snapshot of lines and circles/arcs square to the plane; tilted circles, splines and edges square to the plane are skipped without a message (S45).
- Snapping to a point-on-curve or midpoint adds a constraint (stays on the line when dragged; delete to free it). Alignment guides use points only. Axis-line snaps add no constraint, so the point can drift when dimensions change; use the fixed origin point for constraints.
- Rectangle corner options: size clamped to just under half the shorter side; the rubber band shows square corners; rounded rectangles do not reuse snapped corner points.
- Round corner works only where exactly two straight lines meet and drops dimension constraints on the old corner. Offset curve copies are unconstrained plain geometry; open chains offset to the left of the drawing direction. Polygons carry equal-side constraints only, so dragging a corner can skew them.
- Trim and extend handle lines only (crossings with lines and circles); the edited line loses its constraints and gets free end points. Extrude with several nested loops makes inner loops holes; crossing loops are not checked.
- Live size tags are read-only, no arc tag, values rounded to 2 decimals. Drag by body pins all points at the pointer offset, so rectangle sides stretch neighbours; only line and circle bodies were checked in the app.
- Unwrap: a chain is a path of flat faces and cylinders running one direction (a sharp fold unrolls like a bend); a cone must not reach its apex and unrolls under half a turn and cannot chain; regions wider than half a turn are unsupported; regions outside a chain strip are dropped; outlines are 48-point interpolated curves (areas exact). The unrolled sketch has no extrude, revolve or edge projection; its plane sits beside the model and does not follow later changes.
- Ctrl+Z inside a sketch undoes a sketch step, not the model. Escape leaves the sketch once there is nothing to cancel. Sketch dimensions redraw every frame (untested with hundreds). Sketch polygons, trim, extend and unwrap on cones/chains are mostly unit-tested, not hand-tested in the app.

## Keys and settings

- Bare keys need an engaged viewport (pointer over the view, a recent exit, or a click in it; `ENGAGE_GRACE_MS = 1500`). Symptom: a view key does nothing right after using a panel.
- Rules are enforced at assignment and load only. Digit view keys ignore Shift. Only the first chord shows as the hint; rebinding replaces all chords. Ctrl+K may clash with a browser's own search in browsers other than Chrome.
- Leaving the page warns whenever undo steps exist or a sketch is open (an export does not clear it); opening another file over edits does not warn.
- Touch gaps: hide, isolate, show all, look at face and see-through have a key or search entry but no visible button; right-click, hover and keyboard-only paths have no touch equivalent.
- Dimension overlap avoidance estimates text width from the character count (`dimensions.ts`); the first dimension drawn wins.
- Tool-usage counts live in core memory and reset on restart or reconnect; surfaces are `strip`, `search`, `drawer`, `keys`, `drag`, `other`; sketch tools are counted as `sketch_<tool>`, `sketch_extrude`, `sketch_revolve`, `sketch_finish`.

## Platform and release

- Windows build only was produced and smoke-tested locally; CI runs on all four targets (the `macos-15-intel` label is unverified). Bundle about 360 MB. Smoke tests do not cover the GUI, the browser opening, SmartScreen or Gatekeeper. A running `pliable-server` locks `core/.venv`; build in a separate env via `UV_PROJECT_ENVIRONMENT`.
- The launcher exits 20 s after the last tab disconnects, so a sleeping laptop can close the app. Websocket keepalive pings are off so a long operation holding the GIL cannot drop the connection.
- All releases on a machine share one per-user data folder (`%LOCALAPPDATA%\Pliable` on Windows) for autosave and the notice. A session written by a newer format is neither offered nor deleted, so these can accumulate. Optional fix if asked: a `portable.txt` marker beside the app keeps data beside it.
- Autosave liveness is a 30 s heartbeat plus a pid check: a hung process that still heartbeats counts as live, and a reused pid can make a dead session look live for up to 30 s. A release using the old flat layout writes beside the new folders and is adopted as an old session.
- Diagnostics scrubbing is a regex (`diagnostics.py` `scrub`): a path with spaces or a name inside other text could slip through (the dialog shows the text before copying). The browser user-agent is included as is. Not checked on a tester's machine.
- `THIRD_PARTY_NOTICES.md` was written from memory of each project's license; verify before the first release.
- The busy indicator appears after 400 ms for requests not on the quiet list (previews, sketch solves, lookups) in `app/src/client.ts`, shows elapsed seconds only.
- Orthographic still looks off to the owner (see decisions-log).
- Sketch constraints that a drawing tool adds (rectangle sides, snaps onto curves, tangent starts) are flagged `auto`, listed as automatic, lit up on hover and removable singly or all at once (provisional answer (a) to question 12). The unconstrained-drag guarantee is `_keep_unconnected` in `sketch.py`: geometry with no constraint path to the dragged point is restored after each solve. The floating report itself was never reproduced.
- Sketch On Face armed mode: pressing the button with nothing selected waits for the next face selection; only pressing the button again cancels (Escape belongs to the key router). A refused face records `sketch_on_face` as the last tool so the diagnostic report shows why.
- Projecting model edges into a sketch (`face_reference` with `project`) draws lines, full circles and arcs square to the plane. Tilted circles are not drawn (they need an ellipse entity, S44) and edges of other kinds are skipped; both are counted in the status line and their end points are projected as snappable fixed points. Projected axes are drawn 400 units either side of the projected origin only.
