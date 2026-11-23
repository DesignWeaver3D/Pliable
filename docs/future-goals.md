# Future goals

Parked work and not-built ideas. This file is on demand: it is not read at the start of a session. Grep it before adding a row to [progress.md](progress.md) (a related item may become part of the new task), and read it when the queue in progress.md is empty. When the owner picks an item, move it to progress.md as a row that quotes the owner's words, and delete it here. A row that fails or stagnates in an unattended session moves here under Parked with what was tried. No size limit.

## Parked

- **Stored array parameters (long term, needs owner feedback).** Store array parameters like primitives (editable later); today arrays make separate solids. Consider an option for the array to be a compound with its source object.

- **Exact B-rep export for .ifc and .3dm.** Owner: "I want to expand the import and export filetypes to include those that oCCT supports such as: .step, .stp, .stpZ, .iges, .igs, .brep, .brp, .ifc. Also investigate potentially supporting .3dm    Via OpenNURBS / openNURBS bindings." All listed formats are built. .3dm export writes triangle meshes (labelled lossy).
  - Done (2026-11-15): .ifc export writes exact advanced B-reps (`filesifcexact.py`: planes, cylinders, spheres, tori, B-splines, cones as rational B-splines; faceted for a solid with a pole or several shells), no new dependency.
  - Parked (2026-11-15): exact .3dm export. The available wheels cannot add edges, trims or loops and no other library has B-rep classes; the only route without a dependency is writing the B-rep archive bytes by hand (reverse-engineering the format), judged too risky. Meshes stay.
- **App split, rest of the architecture plan** (owner allowed it by the hierarchy; one slice per commit with a Chrome check, riskiest last). Done: `main.ts` selection (`selection.ts`, `modelview.ts`, shared state in `appstate.ts`), the drag and preview code (`itemdrag.ts`), the sketch ask strips and solve loop (`sketchasks.ts`, `sketchsolve.ts`). Left: see the Planned row "Split the large files by job"; then Phase 5 (folders for the flat core files, optional test splitting). Order and rules in [architecture-plan.md](archive/architecture-plan.md).
- **Sketch parity, remaining:** live (non-snapshot) projected edges are not built because edge ids are not stable across model changes (a live edge could silently go stale); shape constraints for ellipses and splines need another solver (the only candidate wheel has no macOS build); control-point splines with weights; hyperbola and parabola arcs. Built: choosing a kept sketch for Array along path and Sweep face, snapping to sketch curves, the View sketch plane.
- **Shared newest-wins preview scheduler** (`app/src/latestwins.ts`): only the hole centre drag uses it; the push/pull drag (`pump`) and form previews (`drainPreviews`) keep their own copies because of extra state; moving them is a risk with no user-visible gain.
- **Holes, parked parts:** sloped or stepped cut walls. Step depth grips, size presets and the Edit cut tool with length and width resize are built.

## Screen sizes and resolutions (added 2026-11-15)

Owner (2026-11-15): "the entire application has no provisions for different screen sizes so far, so we need that added to future." The dock width is adjustable; the rest (high-DPI scaling, small windows, the top strip, the bodies list and drawer) has no size handling. Desktop shell only (Tauri).

## Detach the parameters panel into its own window (added 2026-11-15)

Owner (2026-11-15): pull the side dock out of the application as a separate window, desktop version only, for work on several screens. Plan: move the dock's existing elements into a child window opened by the main window, so their handlers keep running in the main window's code and no state is synced; first a spike on the desktop build to see whether Tauri allows a same-origin child window with script access (the one unknown). Keep it cheap meanwhile: panel code reaches its controls through the elements it made (no `document` lookups), panel styling stays in the global stylesheet and CSS variables, and the panel's listeners sit on its own elements (not `window` or `document`). Open questions: the handle while detached, closing the window re-docks it (never hides), Esc and typing in the other window, whether the Selection Information section goes too, remembering position and size (always start docked). A hand-check on the desktop build, since browser automation cannot drive a Tauri window.

## Light theme when the system is not set to dark (added 2026-11-22)

Owner (2026-11-22): "I'm not interested in working on those anytime soon." Source: the AppImage catalog's test of v0.4.6 (AppImage/appimage.github.io#12244) suggested starting in a light theme and using the dark theme only when the system is set to dark mode or the user chooses it in settings. Not a failure: the test passed. `docs/behavior.md` says "Dark theme only for now.", so this is a change to approved behavior and needs the owner's decision first; it would also need a theme setting and a light version of the viewport colors and dimension styling.

## Update information for the AppImage (added 2026-11-22)

Owner (2026-11-22): "I'm not interested in working on those anytime soon." Source: the same catalog test noted that the AppImage has no update information, so AppImageUpdate and similar tools cannot update it. The fix is in the release process: embed the information when building the AppImage (`appimagetool -u`, in `scripts/build_desktop.py`) and publish the `.zsync` file next to the AppImage in each release. Optional; nothing fails without it.

## Surface modeling toolbar group (added 2026-11-23)

Owner (2026-11-23): "Bridge edges and patch fill are surface modeling tools. But, generally, surface modeling workflow hasn't been implemented yet. So those two can be withheld from auto tool bar population for now because i think that surface modeling is likely to be an entirely new grouping in the future when that workflow and its tools are developed." Bridge edges (joins two edges with a ruled surface) and Patch fill (closes a gap bounded by three or more edges) stay out of the automatic top toolbar until a surface modeling grouping exists. Related row: the top toolbar row in `progress.md`.

## Ideas (not built; the owner picks what becomes a row)

Ideas from the local research notes in `docs/research/` (untracked), written in our own words, by behavior only. Nothing here is approved or scheduled. Questions they raise go to [author-guidance.md](author-guidance.md) only if a choice is needed.

- Mouse-modifier shortcuts (owner, 2026-10-24): direct manipulation such as dragging a face is a shortcut for a tool the arrow handle or the tool strip also starts, with the same options; more shortcuts using mouse modifiers are expected, with the modifiers not decided yet.
- Fold Fill hole / remove boss into the Hole tool as a mode later (Defeature fails on blind holes, curved bosses and filleted bosses, so the tool stays for now).
- Sweep along a rail and arrays along a path using kept sketch curves.
- Imperial units: lengths are millimetres through `LENGTH_UNIT` in `app/src/units.ts`; grid spacing and dimensions should follow a unit setting later.
- Per-body see-through is view-only per session; it is not saved with the document.
- Long term: design-intent behavior tied to the auto-chip selections, such as which face moves when a face-to-face distance is edited in place (owner, 2026-10-20: deferred).
- Next wave, not started (owner, 2026-10-31): after sketch workflow fluidity and bug fixing, a curve and surface (NURBS) workflow with true 3D sketching, drawing on the direct-modeling and curve tools of the open-source parametric modeler's add-ins. Concept and the owner's words are in the local `docs/research/nurbs-wave.md`; do not research or build until the owner says the wave starts.
- Long term (owner, 2026-10-31): repair or flag geometry errors when importing STEP files, so a broken body does not arrive silently unusable. Related Parked items: none found.
- Formulas, next steps (owner, 2026-11-01): numbers, + - * / ^, unary signs and brackets already work in number fields, dimension values, gizmo typing and sketch-size typing. Not built: functions, pi, units, percent, implicit multiplication, named values and dimensions, keeping the formula beside its value (evaluated in the core), and decimal-comma text built by the core. Related Parked items: none found.

Status words: **Not built** (no sign of it in the code or the tracked docs when this page was written, 2026-10-24), **Check** (probably partly built; look before starting), **Conflicts** (clashes with an approved behavior in [behavior.md](behavior.md)), **Parked** (listed under Parked above).

### Design intent without history

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

### Tool workflow ideas

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
11. Edit a pattern from one of its members (count, spacing). Needs a light pattern record; see "Stored recipes and arrays". Long term.
12. Modifier bundles on drag (Shift, Alt, Ctrl variations) once chips exist. S. This is the same topic as the mouse-modifier shortcuts in the planned one push/pull path row.

### Drawing and direct-edit ideas

- **Plane from the face under the cursor.** The first click of a draw tool fixes the plane to the flat face under the pointer, otherwise the base plane; arrow keys force a plane. Check: "Sketch On Geometry" exists, so this is probably partly there.
- **Snap priority ladder.** Order: exact points (ends, midpoints, face and hole centres), then axis lock from the last point, then an axis ray ending where it crosses an edge, then on-edge, on-face, plane; the status text names the snap. Check against `sketchsnap.ts`.
- **Pull stops.** Push/pull snaps inward drags to the far face when the profile is fully covered (an exact through-cut), and snaps to the level of other parallel faces or edges, landing exactly on a level that is within a hair. Check: the watchlist mentions an opposite-face rule for symmetric push/pull only.
- **Loose lines that close into a face by themselves**, and **drawing straight into a body to split its face.** Conflicts: kept sketches stay separate and add no faces on Finish (behavior.md), so only the plane and snap ideas fit.
- **Drawing on curved faces** (a straight segment in the face's own coordinates becomes an exact curve on the surface). Not built; later.
- **Merge coplanar neighbours after booleans.** Mostly useful for mesh imports, which are not supported yet.
- **Merge free-form faces on one surface.** Two B-spline faces whose surfaces coincide (sample points within the merge length, outward normals agreeing) are left as two faces; joining them would reuse the volume and area check per group. Out of scope by decision (decisions-log 2026-11-14); two such pairs are in the owner's mirror model.

### Sketch ideas still open

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

### Stored recipes and arrays (feeds the stored array parameters row)

A comparison of how other tools treat a primitive after it is combined with something gave three options for a tool with no history:

- **A.** The combined result becomes an ordinary solid; sizes are lost, undo is the way back. Simplest. This is how arrays work today.
- **B.** Keep each part's recipe as a hidden record that an explicit "separate" command restores. Drop it when any face-level edit touches the result; rigid moves keep it. The notes recommend this.
- **C.** Keep a nested group (fully reversible, but a hidden history every tool must understand).

The evidence is thin (a few searches, mostly unverified), so treat it as a question for the owner, not a finding. It bears on the stored array parameters questions: store array parameters like primitives do, or make the array a compound with its source object.
