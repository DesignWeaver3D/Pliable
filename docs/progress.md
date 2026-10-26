# Progress

Open work only, for the rebuild in [ROADMAP.md](../ROADMAP.md). Read this first in every session. Keep it under about 48 KB: when work is finished, delete its entry (git keeps the history; describe the change in the commit message). Rows have no numbers; the title is the identity.

Where things go: open to-dos here; parked work and not-built ideas in the last two sections here (judge every new row against them, because a related idea may become part of the new task); blocking owner questions in [questions.md](questions.md); things for the owner to hand-test in [testing-checklist.md](testing-checklist.md); approved behavior in [behavior.md](behavior.md); decisions in [decisions-log.md](decisions-log.md); shortcuts and guesses in [watchlist.md](watchlist.md); lasting technical notes in [dev-notes.md](dev-notes.md).

New rows quote the owner's request in their own words, then list what it needs as a checklist. A row is deleted only when every checklist item is verified against the quote.

State (2026-10-26): `main` is the development branch and the only long-lived one (protected: contributors use pull requests, the owner pushes directly; see CONTRIBUTING.md). `v0.3.0` is published; the `v0.4.0` draft (the Tauri portable desktop build) awaits the owner's publish. Later commits on `main` may be unpushed (check `git status -sb`). No agent is running. Do not use the word MVP. Run the tests first (`uv run pytest` in `core/`, `npm test`, `npx tsc --noEmit`, `npm run build` in `app/`). Owner decisions in force: sketch automatic constraints on by default; grid off by default; sketch geometry stays separate from the model; kept sketches persist (see `decisions-log.md`). Do not invent work; ask the owner for hand-test results or new requests.

## Planned (not started; discuss before coding)

- Split `app/src/manipulator.ts` (762 lines): move arrows, grid grips and the turn arcs (drawing, hit test, snap ticks) are separate jobs; the turn arcs could move to their own file. Raised after the edge gizmo work; no owner request yet.

- **White viewport after a symmetry constraint (bug, high priority: risk of lost work).** Owner: "While sketching I made a symmetry constraint and the entire background turned white and sketch axis origin and sketch geometry cannot be seen but dimensions are still visible. No error reported and otherwise the UI elements are there and allow editing. Clicking finish sketch did not resolve the issue. Refreshing the browser tab fixed, but we cannot rely on refreshing the browser tab which always poses a lost work risk becuase sometimes the project state doesn't restore to latest."
  - [ ] (In progress: not reproduced with two lines about a line or point, a core fuzz of 1500 symmetric sketches gave no NaN; the loop is now guarded and shows a status error if a frame part throws, so the next occurrence names the cause.) Find the cause. Likely a render failure in the 3D view (for example a NaN or invalid value in the symmetry constraint's geometry, or a lost WebGL context) while the HTML dimension labels keep working; check the browser console and the symmetry constraint code path.
  - [ ] Symmetry constraint no longer blanks the viewport; add a test for any bad value found if it can run without a browser.
  - [ ] Separate row if confirmed: the project state does not always restore to the latest after a refresh (owner: "sometimes the project state doesn't restore to latest"). Reproduce and investigate the autosave and restore path.
- **Stored array parameters (long term, needs owner feedback).** Store array parameters like primitives (editable later); today arrays make separate solids. Consider an option for the array to be a compound with its source object.

- **Problems noted on the first hand-test pass (owner, 2026-10-18; verify each still happens before working on it).** Quoted from the owner's notes:
  - [ ] Open STEP: "does not warn that current model will be deleted. Does not offer option to add to current session (mulitple solids)." Combine STEP: "Maybe the options should just be import or exxport and work from there."
  - [ ] Export STEP: "does not provide dialog to define export name or file type or destination."
  - [ ] Click select: "unclear what shift select does. Appears to create selection chips but then don't know what to do next. Sometimes hard to select edges. hard to select small faces without zooming way in."
  - [ ] Double-click chain: "sometimes adds non-tangent edges which is wrong. Ctrl+doubleclick doesn't behave as expected."
  - [ ] Related-face chips: "unknown how to work with chips altogether."
  - [ ] "All edges" and "Edge loops" for a selected face: "both appear to do same thing. Edge loop should be the outperimeter edges, or have a different name perhaps."
  - [ ] Measurements: "sometimes after other tool usage stops working and need to refresh the browser tab to get it working again."
  - [ ] Push/pull: "M mode is regression that doesn't work when right-click mode did (can't use right click because need right-drag for orbit?). Push/pull hole face does nothing at all, starts a box selection."
  - [ ] Delete face: "works on circular holes. fails otherwise with no error or message why. This was supposed to be named Defeature. Delete face doesn't make sense in all the contexts that this is supposed to work."
  - [ ] Align face: "grayed out and i have no idea what it's supposed to do anyway."
- **Export mesh tessellation options.** Owner: "the export STL worked. However, it didn't provide any tessellation options, so that can be added to future tasks. User should be able to define the angular deviation and another tessellation option. And the default settings should match the default import tessellation settings that orcaslicer uses." Related items checked: nothing in Parked or Ideas covers export tessellation (the mesh-import note and the display tessellation entry in the watchlist are about other things).
  - [ ] Export mesh (STL and the other mesh formats) asks for the angular deviation and one more tessellation option (likely linear deflection) before exporting.
  - [ ] Look up the default tessellation values the slicer named in the quote uses when it imports a STEP file, and use them as the defaults; record the source in `docs/decisions-log.md` (not verified yet, do not guess).
  - [ ] Export tessellation is separate from the display tessellation, so changing it does not change what is drawn.
- **Sketch 2D fillet and chamfer.** Owner: "Sketch needs 2d fillet and 2d chamfer tools."
  - [ ] Fillet and Chamfer sketch tools for the corner between two lines (and line and arc), with a typed value, in the same tool strip and style as the other sketch tools. Related: the Round face edges and Fillet ideas are 3D only.
- **Pre-filleted rectangles (discuss first).** Owner: "Sketch rectangle tool needs options for pre-filleted rectangles. Need to discuss how we can choose options on the fly. If on the fly is troublesome then we need additional rectangle tool drop menu for selecting the various types. Need to determine the approach that provides most intuitive UX."
  - [ ] Propose the options (on the fly while drawing versus a rectangle drop menu) and ask the owner before building. Related: the sizes typed with Tab (behavior.md) and the corner-style field in the sketch card.
- **Trim does not cut the segment between an end point and a crossing.** Owner: "Sketch trim tool changes clicked edges to construction first click and deletes second click, but does not actually cut the segment that's between a line endpoint and another line intersection."
  - [ ] Reproduce: clicking the piece between a line end and its nearest crossing; the cut must happen there too. Check against the two-click Trim rule in behavior.md before changing it.
- **Split should split at a constrained point on the line.** Owner: "Sketch plit cuts the line where cursor clicks but not where there is a point on line constrained point intersection which is where user most often will want the line split. For instance, i have an arc end point connected to the middle of the line. I want to activate Split tool and click the arc end point and the line under it should split exactly at that endpoint and the two new and original arc end point should all be coincident constrained together upon creation automatically."
  - [ ] Split accepts a click on a point that lies on a line (a point-on-line constraint) and splits the line exactly there.
  - [ ] The two new line ends and the original point become Coincident automatically.
- **Automatic redundant constraints: the newest user constraint wins.** Owner: "Sketch automatic redundant should always favor the newest user created constraint and delete any existing automatic that would be redundant to it with a warning message that a constraint was automatically deleted. Current behavior favors pre-existing constraints, but all user maunually created constraints should take precedence over automatically created constraints."
  - [ ] A user-made constraint that is redundant with an automatic one removes the automatic one and shows a warning naming it. Related: the Ideas entry about showing what auto-removal changed; behavior.md says a redundant dimension becomes a reference dimension (decide how the two fit).
- **Arc radius leader points at an end point and cannot move freely.** Owner: "Sketch arc radius so far always points at one of its end points instead of at the arc edge. Therefore cannot move the radius leader freely. Also radius constraint leader should support creating a helper construction arc if user moves radius leader past either arc endpoint."
  - [ ] The radius leader points at the arc edge and can be dragged freely around it.
  - [ ] Dragging the leader past either end point creates a helper construction arc for the leader to sit on.
- **Fully constrained colouring is unreliable.** Owner: "Sketch fully constrained coloring is not reliable at coloring all fully constrained geometry."
  - [ ] Find sketches where fully constrained geometry is not coloured as such and fix the cause; add a core test if it can run without a browser.
- **Constraints list scrolls on its own.** Owner: "Sketch card Constraints list should have its own scroll rather than the entire card being scrolled."
  - [ ] The list scrolls inside the card with the card's buttons staying in place.
- **Delete buttons use a trash can icon.** Owner: "Delete icon buttons should use a trash can icon instead of X which is used for the X-ray view (body see-through, pick-through mode). There are delete icon buttons in the sketch list and constraints list, at least and anywhere else should use the same icon and button for delete."
  - [ ] One shared trash can delete button used in the sketch list, the constraints list and everywhere else a row has an X delete; the X stays for see-through only.
- **Sketch hotkeys for constraints (discuss first).** Owner: "Discussion: Can sketch mode have its own hotkeys that conflict with non-sketch mode hotkeys? I find myself wanting to use hotkeys for applying constraints as habits created while using [another CAD program]. Proposed hotkeys during sketch editing: C - coinsident, E - Equal, S - Symmetry, P - Parallel, V - vertical, H - horizontal, T - tangent, L - perpendicular (capital L looks like a square & P already used), R - radius."
  - [ ] Answer the question (sketch-only keys that override model keys while a sketch is open) and list the conflicts (V, H, P, S, T and others are model keys today). Related: the Ideas entry for one key table with a hotkey field per tool. Do not build before the owner decides.
- **Dimension and Horizontal/Vertical variants under one tool (discuss first).** Owner: "Discuss Sketch constraints:  some constraints are related and are more strict than their smart counterparts. Dimension covers a lot, but sometimes user needs to define Horizontal Distance or Vertical Distance explicitly when it would be ambiguous for smart Dimension tool. So I think it would make sense for those two to be under the Dimension tool as a drop list selection. Same for Vertical and Horizontal being special drop-menu selections under the combined horizontal/Vertical constraint tool. We want the smart tools to work as often as possible but still allow user control."
  - [ ] Propose the strip layout (drop list under Dimension for Horizontal and Vertical distance; drop list under Horizontal / vertical for the strict ones) and ask the owner. This changes the approved button row in behavior.md, so no edits before approval.
- **Degrees of freedom message is a clickable highlight.** Owner: "Sketch constraint solver sometimes reports 1 degree of freedom left when I cannot find any. Degree of Freedom message should be a clickable link that highlights the edges and vertices with remaining degrees of freedom. Highlight can be bright yellow."
  - [ ] Clicking the message highlights the edges and vertices that still have freedom, in bright yellow.
  - [ ] Check the cases where one degree is reported but none can be found (the highlight shows which); fix the count if it is wrong.
- **Mirror from the bodies list, with origin and datum planes and a pick-plane button.** Owner: "Mirror tool needs to be available when selecting one or more bodies in the body list. User should also be able to use the origin planes or datum planes that still need to be built to support this functionality. Also Mirror card needs a pick plane button in case the tool is started with the wrong face selected so user doesn't have to start over but can redefine the mirror plane during the operation."
  - [ ] Mirror is offered for selected bodies in the bodies list.
  - [ ] The mirror plane can be an origin plane or a datum plane (the origin planes and the datum plane support must exist first).
  - [ ] The Mirror card has a Pick plane button to redefine the plane while the tool is open.
- **New Project clears the tool first.** Owner: "New project should clear the tool selection before iniating the project state to prevent tool selection errors from being printed."
  - [ ] Menu > New Project ends the active tool before the state is reset, so no tool selection errors reach the status line or the diagnostics report.
- **Sketch constraint marks hide arc and circle centre points.** Owner: "Sketch some constraints are still obscuring arc and circle centerpoints. The centers are currently selectable, but often cannot see the vertex or that it is highlighted as part of the current selection."
  - [ ] Constraint marks and dimension text are placed so the centre point and its selected highlight stay visible.
- **Global display precision (discuss first).** Owner: "Global settings need a global precision to declare UI rounding. Currently, it appears the UI hides decimals when they are all zero and dynamically displays precision, which i like, but when the decimals are many the default behavior appears to be two decimals, but user should be able to select more up to 8 or the rounding limit that most functions use, if there is a limit. Discuss."
  - [ ] Find the rounding limit the functions use, then propose a precision setting (keeping the hide-zero-decimals look) and ask the owner.
- **Cut with plane: any planar object, gizmo, and named sides (discuss first).** Owner: "I thought there was a separate tool called Split with Plane that is missing now. Was it combined into Cut with Plane? Appears so. The cut plane should be able to pick any planar object like a face, sketch, datum plane, etc. The cut plane should have a gizmo to relocate and tilt it similar to the face push/pull gizmo. Remove side should not be a list of numbers, should be None, Side1, Side2 with the side text color matching the proposed tool body colors."
  - [ ] Answer the question: Split with plane and Cut with plane were merged into one tool with a keep option (see the parked Cut with plane rows; the owner question there is pending, so confirm the merge).
  - [ ] The plane can be picked from a face, sketch, datum plane or any other planar object.
  - [ ] A gizmo moves and tilts the plane like the face push/pull gizmo.
  - [ ] The remove side list reads None, Side 1, Side 2, each in the colour of the body it will give.
- **Using a gizmo must not apply the tool.** Owner: "Using the gizmos for any tool should not exit and apply the tool. Exiting and appling the tool should be when user clicks completely emtpy space meaning no object, gizmo anything is under the cursor at the click."
  - [ ] Dragging or clicking any gizmo keeps the tool open; only a click on completely empty space (nothing, no gizmo, under the pointer) applies it. This changes the approved rule in behavior.md that clicking another item also applies the tool, so confirm that with the owner and then update behavior.md.
- **More import and export file types.** Owner: "I want to expand the import and export filetypes to include those that oCCT supports such as: .step, .stp, .stpZ, .iges, .igs, .brep, .brp, .ifc. Also investigate potentially supporting .3dm    Via OpenNURBS / openNURBS bindings."
  - [ ] Import and export the formats OCCT supports: .step, .stp, .stpZ, .iges, .igs, .brep, .brp, .ifc (check each against the installed OCCT build and its licence first).
  - [ ] Investigate .3dm through OpenNURBS bindings and report licence, size and feasibility before building.
- **Round face edges needs a radius gizmo.** Owner (testing checklist, 2026-10-26): "Round face edges works but has no gizmo to edit the fillet radius in the 3d view."
  - [ ] A radius gizmo in the 3D view, built like the existing fillet and Inset face edges gizmos.
- **Divide face: edge gizmo and more ways to divide.** Owner (testing checklist, 2026-10-26): "Divide face works but has no gizmo to move the edge that's being created. Also, divide face should be extended to be able to subdivide the face either linearly in either or arbitrary direction (ratated by °) or subdivided in both directions like a grid with configurable rows and columns."
  - [ ] A gizmo that moves the divide edge being created.
  - [ ] Divide linearly in either direction or in an arbitrary direction (rotated by a typed angle).
  - [ ] Divide in both directions as a grid with configurable rows and columns.
- **Inset face: the all-edges or perimeter ball (discuss).** Owner (testing checklist, 2026-10-26): "Inset face is working great as well as its gizmo. The selector between all face edges and only perimeter is a ball that can be clicked. This should be discussed as other tools don't use this approach, but maybe they should because its quick, discoverable, and has complete instructions on what it does."
  - [ ] Discuss with the owner whether other tools should use the same clickable ball selector for their options; no change before that.
- **Resize fillet fails on a fillet that runs along a chain of edges.** Owner (testing checklist, 2026-10-26): "Resize fillet error "That face is not a simple fillet between two faces" because the fillet applies to a chain of edges, but tool should still allow editing the fillet. Works for simple fillet only affecting two faces."
  - [ ] Resize fillet works on a fillet face that belongs to a chain of edges, not only on a simple fillet between two faces; reproduce first and add a core test.
- **Quick two-distance mode while creating a chamfer (discuss).** Owner (testing checklist, 2026-10-26): "resize chamfer and the two distance gizmos work great. Need a way to quickly enter two distance mode while creating a chamfer. Maybe pressing ALt or tab while in chamfer creation is still active. Discuss."
  - [ ] Choose the key (Alt, Tab or another) with the owner, then let a chamfer being created switch to two distances. Related: the typed-number Tab behavior and the Alt+click face cycling must not clash.
- **What is Chamfer (distance and angle)? (answer the owner).** Owner (testing checklist, 2026-10-26): "There's a line item for "chamfer_distance_angle" and I don't know what it is referring to."
  - [ ] Answer: it is the tool listed as Chamfer (distance and angle) in Edges. Explain what it does in its tooltip and check it works; ask the owner whether to keep it.
- **Remove fillet/chamfer tool may be unnecessary (discuss).** Owner (testing checklist, 2026-10-26): "Remove fillet/chamfer tool is unnecessary because the Defeature tool already does the same thing."
  - [ ] Check that Defeature (delete_face) removes fillets and chamfers everywhere Remove fillet/chamfer does, then ask the owner before removing the tool.
- **Circular array: gizmos and axis picking.** Owner (testing checklist, 2026-10-26): "Circular array needs gizmos for count and angle plus needs an option for user to pick the axis by selecting any axis or edge in the 3d view."
  - [ ] Gizmos for count and angle. Related: the planned array gizmos rows.
  - [ ] Pick the axis from any axis or edge in the 3D view.
- **Arrays should work on selected features.** Owner (testing checklist, 2026-10-26): "Arrays should work on selected features too. Such as selecting faces of a boss or hole, etc."
  - [ ] Linear, circular and path arrays accept selected features (the faces of a boss or hole and so on), not only bodies. Related: the existing hole pattern tools (pattern_hole, pattern_hole_circular).
- **Move hole/boss needs a gizmo.** Owner (testing checklist, 2026-10-26): "Move hole/boss works with multiple holes selected, they all move together. However, this tool needs a gizmo for editing it in the 3d view."
  - [ ] A gizmo for Move hole/boss in the 3D view. Related: the parked Holes row about move, resize and depth handles.
- **Distribute holes/bosses is unclear.** Owner (testing checklist, 2026-10-26): "Distribute holes/bosses I think is entended to do something like how I said arrays should apply to features, but it's current implementation is not intuitive. It's not clear to me what the tool is trying to do when I select the 4 holes in the bottom portion of the included bracket shape."
  - [ ] Explain what the tool does today with the four bracket holes; then redesign or merge it with arrays on features (previous row) after asking the owner.
- **Fill hole / remove boss tool may be unnecessary (discuss).** Owner (testing checklist, 2026-10-26): "Fill hole/remove boss tool is not needed as the defeature tool does this work."
  - [ ] Check that Defeature covers every case of fill_hole, then ask the owner before removing the tool.
- **Path array is not visible in the UI.** Owner (testing checklist, 2026-10-26): "I cannot see a path array tool in the UI."
  - [ ] Find why: the tool (Array along path) appeared in the strip only when an edge was selected in the v0.4.0 build and is not in the default tool strip; make it findable (list entry, search, tooltip saying it needs an edge) and check it is in the All tools list.
- **Revolve face and Sweep cannot take a face plus an edge with Ctrl+click.** Owner (testing checklist, 2026-10-26): "Cannot use Revolve face or sweep a face because cannot select a face and an edge in 3d view holding Ctrl+Left click."
  - [ ] Ctrl+click can add an edge to a selected face (and a face to an edge) so Revolve face and Sweep can run; reproduce first.
- **Unify, Patch fill and Bridge are not findable.** Owner (testing checklist, 2026-10-26): "I don't see tools named Unify, Patch_fill, or Bridge in the all tools list or by searching for them."
  - [ ] Find why: the tools are registered as unify, patch_fill and bridge (Patch fill and Bridge edges showed in the strip for an edge selection) but not found by those names in the list or search; give them list entries, titles and search keywords, and say in the tooltip what each needs.

## Parked or owner-dependent

- **App split, rest of the architecture plan** (needs the owner's go-ahead and a Chrome check per slice, riskiest last): `main.ts` selection (`setSelection`, `show`, `setCommitted`) then the drag and preview state machine (`pump`, `drainPreviews`, dimension label); `sketch.ts` pointer handling, solve loop, projection and dimension dialogs; `viewport.ts` (not started); then Phase 5 (folders for the flat core files, optional test splitting). Remaining `main.ts` and `sketch.ts` code shares module-level state, so the next slice needs a small shared-state object or explicit getters, a design choice the owner should confirm first. Order and rules in [architecture-plan.md](archive/architecture-plan.md).
- **Alpha release:** `v0.3.0` is tagged and its draft release awaits the owner. Do not publish, tag or merge to `main` without the owner's explicit go-ahead each time. The next release series is `v0.4.0` (move to a Tauri local portable install, to last until 1.0). The alpha tool-coverage decision is provisional (every core tool has a test; none hidden or marked experimental).
- **Sketch parity:** profile faces cannot yet be picked or dragged with the push/pull arrow; sketch curves are not selectable or snappable; shape constraints for ellipses and splines need another solver (the only candidate wheel has no macOS build); control-point splines with weights; hyperbola and parabola arcs; live (non-snapshot) projected edges; kept sketches not yet usable as sweep rails or array paths.
- **Shared newest-wins preview scheduler** (`app/src/latestwins.ts`): only the hole centre drag uses it; the push/pull drag (`pump`) and form previews (`drainPreviews`) keep their own copies because of extra state; moving them is a risk with no user-visible gain.
- **Holes, parked parts:** non-round through voids (squares, slots) getting move, resize and depth handles; draggable depth grips for counterbore and countersink steps (numbers for now); threads; standard size tables.
- **Cut with plane, parked parts:** choosing the half by two special colours; a movable on-screen plane; creating the plane from a face, three points, edge and point, or offset or angle (the core builders exist, the tool still takes numbers).
- **Selection:** make a hole's centre a selectable item of its own (the dots still pick the hole's face); conical mouths.

## Ideas (not built; the owner picks what becomes a row)

Ideas from the local research notes in `docs/research/` (untracked), written in our own words, by behavior only. Nothing here is approved or scheduled. Questions they raise are in [questions.md](questions.md).

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
