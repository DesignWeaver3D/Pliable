# Progress

Open work only, for the rebuild in [ROADMAP.md](../ROADMAP.md). Read this first in every session. Keep it under about 48 KB: when work is finished, delete its entry (git keeps the history; describe the change in the commit message). Rows have no numbers; the title is the identity.

Where things go: open to-dos here; parked work and not-built ideas in the last two sections here (judge every new row against them, because a related idea may become part of the new task); everything that needs the owner's time (hand-tests, questions, approvals) in [author-guidance.md](author-guidance.md); approved behavior in [behavior.md](behavior.md); decisions in [decisions-log.md](decisions-log.md); shortcuts and guesses in [watchlist.md](watchlist.md); lasting technical notes in [dev-notes.md](dev-notes.md).

New rows quote the owner's request in their own words, then list what it needs as a checklist. A row is deleted only when every checklist item is verified against the quote.

State (2026-10-26): `main` is the development branch and the only long-lived one (protected: contributors use pull requests, the owner pushes directly; see CONTRIBUTING.md). `v0.3.0` is published; the `v0.4.0` draft (the Tauri portable desktop build) awaits the owner's publish. Later commits on `main` may be unpushed (check `git status -sb`). No agent is running. Do not use the word MVP. Run the tests first (`uv run pytest` in `core/`, `npm test`, `npx tsc --noEmit`, `npm run build` in `app/`). Owner decisions in force: sketch automatic constraints on by default; grid off by default; sketch geometry stays separate from the model; kept sketches persist (see `decisions-log.md`). Do not invent work; ask the owner for hand-test results or new requests.

## Planned (not started; discuss before coding)

## Review of 2026-10-26 session B (owner review; quotes are the owner's words)

Related existing items checked: Parked/Ideas "Stored array parameters" (arrays stay separate solids; the compound-union row below does not touch it), "Merge Cut with plane and Split with plane" (the Cut with plane card row touches it: keep the two tools separate), "Axis lock keys" and "Mouse-modifier shortcuts" (the measure double-click row touches them).

Tool group UI (arrays, gizmos, cards):

- **Push/pull tilt typed entry and gizmo layout.** Owner: "Face push/pull vector tilt direct entry is buggy. Starting a tilt and entering a value might tilt that angle in the same or opposite direction. Entering a tilt value in the other gizmo resets the first tilt gizmo to 0 (face normal) and setting either to zero sets both to zero at face normal. hitting Esc while entering a tilt angle cancels just that entry but doesn't escape the task which is good. User should be able to tilt one gizmo by an entered degree angle then the other and the first keep its value and angle values should know the dirction the tilt gizmowas pulled and positive numbers go that value and negative the opposite. I think the gizmo needs ediing. The target symbol should be right at the intersecton of the tilt arcs and the push/pull arrow should be much longer where the stem passes through both pick icon and tilt arcs and extends about the same distance as it is currently off the face past the target icon. This will help maintain ability to grab arrowhead that has been obscured by the pick icon and tilt arcs."
  - [ ] Typed degrees on one tilt arc keep the other arc's angle; zero on one arc leaves the other.
  - [ ] The sign of a typed angle follows the direction the arc was pulled (positive continues that way, negative the opposite).
  - [ ] Esc during entry still cancels only the entry.
  - [ ] Target symbol sits at the intersection of the tilt arcs; the arrow stem is much longer, passing through the pick icon and arcs, and extends past the target icon about as far as it extends off the face now, so the arrowhead stays grabbable.
  - [ ] Tests for the angle state; update behavior.md.
- **Linear Array card and gizmos.** Owner: "Linear Array: typed rows/columns works and esc exits just that data entry without closing the operation which is good. The card needs better parameter naming and order. First field says Count and should be "Columns" which should be grouped together with the column spacing (dx) & Z-Offset (dz). Next group should be Rows, row spacing (dy2) & Z-Offset (dz2). Y-Offset (dy) can be by itself, I guess there is only one option here because an X-Offset would do the same thing? If so then that single parameter can be Planar Shift (but I really think there should be one fore each direction). For each parameter in the card, there should be an associated gizmo (this is a global tool behavior). Spacing gizmo should only be indicated between the first (source) and second instance of the array in either column or row. The Z-offsets can be shown as an upward arrow above the top of the second instance in both column and row.X and Y offsets can be arrows pointing out the side of the second instance object."
  - [ ] Card order: Columns with column spacing and Z-offset; Rows with row spacing and Z-offset; planar shift fields (one per direction if the parameter model allows it, decided from the code).
  - [ ] A gizmo for every parameter; spacing gizmos only between the source and second instance; Z-offsets as an upward arrow above the second instance; X and Y offsets as arrows out of its side.
  - [ ] Check the global rule "every card parameter has a gizmo" against the other tools and list the gaps as rows.
- **Circular Array angle and count gizmos.** Owner: "Circular Array: The Angle grip should look like a pie-slice type angle that user drags around the axis so a short indicator line pointing from the source object toward the axis then an arc that goes around to the short line pointing from last instance toward the axis with the degrees value displayed on the arc and that is editable by entering mid gizmo turn or in the card or by double clicking the screen value. Angle max value should be 360°. Count should be integers, min value 1, default 2. Count can be a editable value shown over the source object with user can mouse wheel while cursor over value to increase/decrease count. When clicking at nothing, operation should be applied (this is a global tool behavior)."
  - [ ] Pie-slice angle gizmo with the value on the arc, editable by typing mid-drag, in the card, or by double-clicking the value; maximum 360.
  - [ ] Count is an integer, minimum 1, default 2, an editable value over the source object that changes with the mouse wheel.
  - [ ] A click on nothing applies the open tool (check every tool).
- **Concentric circular array (new tool).** Owner: "I want another array tool that does concentric circular patterns." (No further detail: decide the parameters from the hierarchy and log them.)
  - [ ] Tool with rings (count, radial spacing) and per-ring count, gizmos on every parameter, test, tool strip entry.
- **Eyedropper buttons in cards.** Owner: "All tool cards that have values with "eyedropper" should be a eyedropper icon button instead of an autoresizing button and they should all be aligned in the card. The current button looks weird and often the parameter label is getting wrapped to the next row which looks bad. So right justify both the eydropper and the value box next to it and leave the labels left justified will look much better."
  - [ ] Icon-only eyedropper button; labels left, eyedropper and value box right-aligned in a column; labels never wrap.
- **Cut with plane card.** Owner: "Cut with Plane: Default Remove side should be None. Remove side drop menu should match the dark theme used everywhere else. Pick plane button should be at the top of the card and have center justified button label. Axis label and box are no longer needed. The origin planes should be 3 buttons in a row right below the Pick plane button and they should only say XY, XZ, YZ using center justified button label text. I have no idea what the nx, ny, nz parameters do."
  - [ ] Default Remove side None; dark-themed list; Pick plane first with a centred label; three buttons XY, XZ, YZ right below; Axis field removed; nx, ny, nz explained in the field tooltip or hidden if redundant (decide from the code).
- **Countersink and counterbore measurement and angle.** Owner: "Countersink and counterbore measurements should be an offset value of the hole, or option to enter either." and "Countersink gizmo works great. Need another gizmo for angle. And there should be a droplist of the top 5 most used standard screw countersink head angles."
  - [ ] Enter the counterbore and countersink size either as a diameter or as an offset from the hole (a choice on the card).
  - [ ] Angle gizmo for the countersink; droplist of the five most used standard head angles (82, 90, 100, 110, 120 degrees unless the code says otherwise).
- **Add slot gizmos.** Owner: "Add slot tool has no gizmos."
  - [ ] Gizmos for every slot parameter (position, length, width, depth), as the other hole tools do.

Tool group CORE (selection, kernel, performance):

- **Slower 3D interaction (bug, high priority).** Owner: "The latest changes have caused the overall 3D view interaction to become slower. Available tool buttons take longer to populate and so do selection widgets."
  - [ ] Profile selecting faces and edges (tool strip availability and selection widgets) on a large model; find the commits that slowed it and fix the cause; add a timing test where it can run without a browser.
- **Measure (M) hint and double-click.** Owner: "push/pull measure (M): I don't understand what the shift-click shows hint line is supposed to mean. Double-click a measure candidate exited the push/pull operation and started a chamfer/fillet on that edge. I don't know what the double-click was trying to acheive."
  - [ ] Read behavior.md first. Decision to apply unless it conflicts: in measure mode a double-click on a candidate acts as a pick (no other tool starts); the Shift+click hint is reworded to say what it does in plain words or removed.
- **Coplanar chip on several solids.** Owner: "Coplanar chip selection does not work on multiple solids but it should."
  - [ ] Coplanar selection adds the coplanar faces of every solid, test.
- **Union of separate bodies.** Owner: "Boolean union on non-overlapping bodies should convert it to a compound body."
  - [ ] Union with no overlap yields one compound body, test.
- **Global axes.** Owner: "Global axes are not selectable."
  - [ ] Global axes can be picked and used as an axis input by tools.
- **Revolve face without an axis.** Owner: "Select a face should enable Revolve face tool even if no axis is selected and user can select the axis after starting the tool."
  - [ ] Revolve face available with a face only; axis picked after the tool starts.
- **Sketch faces and edges.** Owner: "Selecting a sketch area face doesn't allow Ctrl+click to add an edge to selection. Therefore cannot test Revolve face tool using a sketch. Cannot select the entire sketch in Sketch list and add edge to selection either."
  - [ ] Ctrl+click adds an edge to a selected sketch area; the same with a whole sketch chosen in the Sketch list; Revolve face then works from a sketch with a picked edge as the axis.
- **Emboss and Cut along surface on cylinders.** Owner: "Emboss/Cut along a surface appears to do what push/pull does when a cylindrical face is selected that's not a hole."
  - [ ] On a cylinder that is not a hole the tools wrap the sketch region onto the surface (not push/pull); test.
- **Stretch tool.** Owner: "Stretch tool doesn't work at all."
  - [ ] Reproduce through the server path, fix, test.
- **Face Draft pick axis.** Owner: "Draft pick axis sort of works but fails silently for some picked edges."
  - [ ] Every picked edge works or the form says why it cannot, test.

- Split `app/src/manipulator.ts` (762 lines): move arrows, grid grips and the turn arcs (drawing, hit test, snap ticks) are separate jobs; the turn arcs could move to their own file. Raised after the edge gizmo work; no owner request yet.

- **White viewport after a symmetry constraint (bug, high priority: risk of lost work).** Owner: "While sketching I made a symmetry constraint and the entire background turned white and sketch axis origin and sketch geometry cannot be seen but dimensions are still visible. No error reported and otherwise the UI elements are there and allow editing. Clicking finish sketch did not resolve the issue. Refreshing the browser tab fixed, but we cannot rely on refreshing the browser tab which always poses a lost work risk becuase sometimes the project state doesn't restore to latest."
  - [ ] (In progress: not reproduced with two lines about a line or point, a core fuzz of 1500 symmetric sketches gave no NaN; the loop is now guarded and shows a status error if a frame part throws, so the next occurrence names the cause.) Find the cause. Likely a render failure in the 3D view (for example a NaN or invalid value in the symmetry constraint's geometry, or a lost WebGL context) while the HTML dimension labels keep working; check the browser console and the symmetry constraint code path.
  - [ ] Symmetry constraint no longer blanks the viewport; add a test for any bad value found if it can run without a browser.
  - [ ] Separate row if confirmed: the project state does not always restore to the latest after a refresh (owner: "sometimes the project state doesn't restore to latest"). Reproduce and investigate the autosave and restore path.
  - Not reproduced; the solver rejects non-finite solutions and the frame loop is guarded. Next: log renderer info and context state when it happens; check the profile-fill mesh and the dimension overlay for NaN.
  - Owner (2026-10-26): could not reproduce either; will report if it recurs. Leave the guarded frame loop as is.
- **Stored array parameters (long term, needs owner feedback).** Store array parameters like primitives (editable later); today arrays make separate solids. Consider an option for the array to be a compound with its source object.

- **Exact B-rep export for .ifc and .3dm.** Owner: "I want to expand the import and export filetypes to include those that oCCT supports such as: .step, .stp, .stpZ, .iges, .igs, .brep, .brp, .ifc. Also investigate potentially supporting .3dm    Via OpenNURBS / openNURBS bindings." All listed formats are built. .ifc export writes faceted B-reps (an imported bracket comes back as many small faces) and .3dm export writes triangle meshes, both labelled lossy.
  - [ ] Exact B-rep export for .ifc (IfcOpenShell's OCC bindings, if a wheel provides them) and for .3dm (the rhino3dm wheels cannot add edges, trims or loops; look for another route such as writing the file with another library); keep the lossy export until then.
- **App split, rest of the architecture plan** (owner allowed it by the hierarchy; one slice per commit with a Chrome check, riskiest last). Done: `main.ts` selection (`selection.ts`, `modelview.ts`, shared state in `appstate.ts`), the drag and preview code (`itemdrag.ts`), the sketch ask strips and solve loop (`sketchasks.ts`, `sketchsolve.ts`). Left: `sketch.ts` pointer handling (onMove, onDown, startDrag, place), projection, editInline/selectDimension (each touches 10+ private fields and has no test; needs a small shared-state object like `appstate.ts` first); `viewport.ts` (not started); then Phase 5 (folders for the flat core files, optional test splitting). Order and rules in [architecture-plan.md](archive/architecture-plan.md).
- **Alpha release:** `v0.3.0` is tagged and its draft release awaits the owner. Do not publish, tag or merge to `main` without the owner's explicit go-ahead each time. The next release series is `v0.4.0` (move to a Tauri local portable install, to last until 1.0). The alpha tool-coverage decision is provisional (every core tool has a test; none hidden or marked experimental).
- **Sketch parity, remaining:** live (non-snapshot) projected edges are not built because edge ids are not stable across model changes (a live edge could silently go stale); shape constraints for ellipses and splines need another solver (the only candidate wheel has no macOS build); control-point splines with weights; hyperbola and parabola arcs. Built: choosing a kept sketch for Array along path and Sweep face, snapping to sketch curves, the View sketch plane.
- **Shared newest-wins preview scheduler** (`app/src/latestwins.ts`): only the hole centre drag uses it; the push/pull drag (`pump`) and form previews (`drainPreviews`) keep their own copies because of extra state; moving them is a risk with no user-visible gain.
- **Holes, parked parts:** sloped or stepped cut walls; threads (not asked). Step depth grips, size presets and the Edit cut tool with length and width resize are built.

## Ideas (not built; the owner picks what becomes a row)

Ideas from the local research notes in `docs/research/` (untracked), written in our own words, by behavior only. Nothing here is approved or scheduled. Questions they raise go to [author-guidance.md](author-guidance.md) only if a choice is needed.

- Mouse-modifier shortcuts (owner, 2026-10-24): direct manipulation such as dragging a face is a shortcut for a tool the arrow handle or the tool strip also starts, with the same options; more shortcuts using mouse modifiers are expected, with the modifiers not decided yet.
- Merge Cut with plane and Split with plane into one tool with a keep option, and let the plane come from a selected face (owner question pending).
- Sweep along a rail and arrays along a path using kept sketch curves.
- Imperial units: lengths are millimetres through `LENGTH_UNIT` in `app/src/units.ts`; grid spacing and dimensions should follow a unit setting later.
- Per-body see-through is view-only per session; it is not saved with the document.
- Long term: design-intent behavior tied to the auto-chip selections, such as which face moves when a face-to-face distance is edited in place (owner, 2026-10-20: deferred).
- Long term: named values and expressions in sketch dimensions (owner, 2026-10-20: numbers only for now).

Status words: **Not built** (no sign of it in the code or the tracked docs when this page was written, 2026-10-24), **Check** (probably partly built; look before starting), **Conflicts** (clashes with an approved behavior in [behavior.md](behavior.md)), **Parked** (already a row in progress.md).

### 1. Design intent without history

The relationship chips (which rules carry related faces along) are built. The rest of that plan is not:

| Idea | What it is | Status |
|---|---|---|
| More detected rules | Parallel, perpendicular, tangent-touching and symmetric-about-plane as chips next to the current ones, each with a tolerance. Test against imported parts for false positives | Check (some rules exist; list them against the code before starting) |
| Rule state on the chips | Show whether a rule is on and used, off and would have moved something, or on and irrelevant; say why a face moved | Not built |
| One-shot alignment tools | "Make coaxial", "make coplanar", "make parallel" with a picked target; afterwards the relationship detects as present | Not built |
| Typed dimension as a driver | Click a measurement, type a new value, choose which end moves (the swap arrows). Built for face distance, hole distance, edge length and a few more; not for every measurement | Check |
| Hole and pattern recognition | Group holes by diameter and detect line, grid and circle spacing as a selection helper for the resize, move and array tools; nothing stored | Not built |
| Work frame handle | A movable origin, axis and plane (with snaps) that move and rotate tools can take as direction or pivot | Not built |
| Soft locks | Lock a relationship by remembering its faces; re-check it after every edit and drop it with a warning if it is lost | Not built; risk is silently stale locks |
| Rule-aware tilt | Tilting a wall carries ribs and tangent fillets along | Not built; the notes suggest parking it as a non-goal |

### 2. Tool workflow ideas

A prioritised list from the workflow comparison. Sizes: S under half a session, M about one, L several.

1. Status line names the armed or default tool and its target ("Drag: push/pull this face"). S. Check: the hint line and first-use tips exist.
2. Mode options declared as data and shown as chips on a tool (add, cut or new body; both sides; keep the tool; tangent chain). M. Not built as a general mechanism.
3. Named slots for tools with several picks (target and tool, profile and axis, profile and path, neutral and target faces) instead of selection order. M. Not built.
4. An always-visible number field with the current value, Tab between fields, replacing the "0 means unchanged" workaround in the resize forms. M. Not built.
5. A hotkey field in each tool declaration and one key table, plus a repeat-last-command key beside Edit last. S to M. Check: the key table exists (`keys.ts`); repeat-last was not found.
6. A boolean choice built into the tools that make volume (extrude, revolve, sweep, loft, push/pull). M. Not built.
7. A failure cue on the model: highlight the faces or edges the kernel names when an operation fails, beside the red status. M. Not built.
8. Axis lock keys (X, Y, Z) and free direction for move and array tools. L. Shares work with the planned one push/pull path and array gizmos rows in progress.md.
9. Up To and Full Pull: push or pull until a chosen face or plane. M. Not built (no code found).
10. Fillets: tangent chain on by default and a warning when a large radius is applied before a small one. S to M. Not built.
11. Edit a pattern from one of its members (count, spacing). Needs a light pattern record; see section 5. Long term.
12. Modifier bundles on drag (Shift, Alt, Ctrl variations) once chips exist. S. This is the same topic as the mouse-modifier shortcuts in the planned one push/pull path row.

### 3. Drawing and direct-edit ideas

- **Plane from the face under the cursor.** The first click of a draw tool fixes the plane to the flat face under the pointer, otherwise the base plane; arrow keys force a plane. Check: "Sketch On Geometry" exists, so this is probably partly there.
- **Snap priority ladder.** Order: exact points (ends, midpoints, face and hole centres), then axis lock from the last point, then an axis ray ending where it crosses an edge, then on-edge, on-face, plane; the status text names the snap. Check against `sketchsnap.ts`.
- **Pull stops.** Push/pull snaps inward drags to the far face when the profile is fully covered (an exact through-cut), and snaps to the level of other parallel faces or edges, landing exactly on a level that is within a hair. Check: the watchlist mentions an opposite-face rule for symmetric push/pull only.
- **Loose lines that close into a face by themselves**, and **drawing straight into a body to split its face.** Conflicts: kept sketches stay separate and add no faces on Finish (behavior.md), so only the plane and snap ideas fit.
- **Drawing on curved faces** (a straight segment in the face's own coordinates becomes an exact curve on the surface). Not built; later.
- **Merge coplanar neighbours after booleans.** Mostly useful for mesh imports, which are not supported yet.

### 4. Sketch ideas still open

Most of the sketch parity list is built (conflict naming, free-point colouring, collinear, lock, point to line distance, reference dimensions, edit selection, slot, three-point arcs and circles, check sketch, kept sketches). What the notes list that is not built or is parked:

- **Sketch on the view plane** ("sketch on screen": a plane square to the camera). Cheap, needs no model geometry. Not built.
- **Plane tangent to a surface, plane square to a curve.** Parked; edge-normal planes are done.
- **A second solver** for full ellipse and spline shape constraints. The notes recommend keeping the current solver and giving ellipses and splines endpoint constraints only; evaluate the other solver on a test set before any switch. Parked.
- **Control-point splines with weights and knots, hyperbola and parabola arcs.** Parked.
- **Live (associative) projected edges** instead of snapshots. Parked; the notes say snapshots suit a model without history.
- **Internal alignment and tangent-at-endpoint with an angle.** Not built.
- **Named values and expressions in dimensions.** The owner chose numbers only for now (progress.md long-term list).
- **A parity checklist:** tick each sketch tool and constraint of a reference program as Done, Different (and why) or Not wanted; keep a scenario set (dimensioned rectangle, slot, tangent chain, symmetric profile, ellipse in a rectangle, spline through points) that every solver change must keep solving without flips.
- **Show what auto-removal changed**, and never silently delete the wrong constraint: show or ask. Check against the existing redundancy reporting.

### 5. Stored recipes and arrays (feeds the stored array parameters row)

A comparison of how other tools treat a primitive after it is combined with something gave three options for a tool with no history:

- **A.** The combined result becomes an ordinary solid; sizes are lost, undo is the way back. Simplest. This is how arrays work today.
- **B.** Keep each part's recipe as a hidden record that an explicit "separate" command restores. Drop it when any face-level edit touches the result; rigid moves keep it. The notes recommend this.
- **C.** Keep a nested group (fully reversible, but a hidden history every tool must understand).

The evidence is thin (a few searches, mostly unverified), so treat it as a question for the owner, not a finding. It bears on the stored array parameters questions: store array parameters like primitives do, or make the array a compound with its source object.
