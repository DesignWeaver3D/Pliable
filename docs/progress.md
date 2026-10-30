# Progress

Open work only, for the rebuild in [ROADMAP.md](../ROADMAP.md). Read this first in every session. Keep it under about 48 KB: when work is finished, delete its entry (git keeps the history; describe the change in the commit message). Rows have no numbers; the title is the identity.

Where things go: open to-dos here; parked work and not-built ideas in the last two sections here (judge every new row against them, because a related idea may become part of the new task); everything that needs the owner's time (hand-tests, questions, approvals) in [author-guidance.md](author-guidance.md); approved behavior in [behavior.md](behavior.md); decisions in [decisions-log.md](decisions-log.md); shortcuts and guesses in [watchlist.md](watchlist.md); lasting technical notes in [dev-notes.md](dev-notes.md).

New rows quote the owner's request in their own words, then list what it needs as a checklist. A row is deleted only when every checklist item is verified against the quote.

State (2026-10-29): `main` is the development branch and the only long-lived one (protected: contributors use pull requests, the owner pushes directly; see CONTRIBUTING.md). `v0.3.0` is published; the `v0.4.0` draft (the Tauri portable desktop build) awaits the owner's publish. About 35 later commits on `main` are not pushed (check `git status -sb`). No agent is running and no worktree is left. Do not use the word MVP. User-visible text uses US spelling. Run the tests first (`uv run pytest` in `core/`, `npm test`, `npx tsc --noEmit`, `npm run build` in `app/`). Owner decisions in force: sketch automatic constraints on by default; grid off by default; sketch geometry stays separate from the model; kept sketches persist (see `decisions-log.md`). Do not invent work; ask the owner for hand-test results or new requests.

## Planned (not started; discuss before coding)

Tool group CORE:

- **All tools usable at all times.** Owner (2026-10-29): "I want all tools in the all tools drawer to be usable at all times. I want the graying to be less prominent, so they will still attempt to lead the user to tools matching the current selection but will not block user if current selection is wrong. I want a new behavior recorded that all tools should work with correct preselection or post selection. That is something I really like about [another CAD program]." Related existing items checked: Ideas "Status line names the armed or default tool" and "Named slots for tools with several picks" (the waiting hint is a small part of the first; named slots would be the proper fix for the multi-pick limit below); Parked: none touch it.
  - [x] Every tool in the drawer can be clicked at any time; one whose selection does not fit waits (`toolwaiting.ts`), says what to select in the status line, and starts when the selection fits. A fitting preselection behaves as before.
  - [x] The drawer's graying is a mild dim (`nofit`), never disabled; the tooltip still says what to select; "usable now" still filters.
  - [x] Recorded in `behavior.md`; tests in `toolwaiting.test.mjs`.
  - [ ] Hand-check in the app (listed in `author-guidance.md`).
  - [ ] Limits left: Escape does not end a wait (choosing another tool does); a tool that opens its form on the first fitting selection (for example 1+ edges) does not take further picks as post-selection; the strip is unchanged (still lists only fitting tools).

- **Helix tools.** Owner (2026-10-27): "We need helix tools added". Scope picked by the owner: coil / helical sweep and helical cut / groove (a helix curve in sketch and threads on cylinders were not picked). Related existing items checked: the Holes row (threads: not asked, stays parked), Ideas "Sweep along a rail and arrays along a path" (a helix is a rail; keep Sweep as is).
  - [x] Coil and helical cut: the Helical sweep tool (mode adds or cuts; built, tested in core, in the Solids tool group).
  - [x] Owner (2026-10-27): Mode reads Add / Subtract, directly under the axis buttons; Subtract cuts every solid the coil meets; a chosen sketch works as the profile. Done for Helical sweep.
  - [ ] Hand-check the Helical sweep gizmos (owner 2026-10-27: pitch as a draggable length dimension outside the profile on the side away from the axis, with extension lines back to the profile middle, an arrowhead grip and the value in the middle of the line; turns as a number, changed by the wheel or double-click typing): built, not yet looked at in the app.
  - [ ] Hand-check the Helical sweep card in the app (axis pick, preview, error text); add the "when X, Y happens" line to behavior.md once approved.

- **Push/pull on a sketch face adds or subtracts.** Owner (2026-10-28): "When I create a sketch on a face of a body and the profile was completely within that face, my expectation was that pushing the sketch face would subtract and pulling would add material to that body because that's how push/pull a face of a body works. Instead pushing inward added more material to the body, while pulling away from the body created a new solid body separate from the original body even though they are mathmatecally touching." Then: "I think I want my expected behavior as long as the sketch is exactly on a face of a solid, which would indicate user wants to modify that body. Sketch profile only needs to intersect/share face surface area to do push subtract and pull add." Related Ideas checked: "A boolean choice built into the tools that make volume" (item 6, this row is the push/pull part of it), "Modifier bundles on drag" (item 12, the Alt modifier below), "Pull stops" (not touched). Decided with the owner (attended, 2026-10-28):
  - Owner refinement (2026-10-28): "I wonder if the auto mode should just always go into subtract mode on push (opposite of face normal) and add on pull (same as face normal). This approach need no coplanar requirement or profile overlap detection." Adopted; the earlier face-sharing detection was reverted. Owner: "Yes on dropping the old fallback behavior" (a push in empty space that removes nothing no longer makes a body).
  - Built and merged to `main` (2026-10-28, tested: 688 core, 366 frontend); open only the owner's hand-check listed in `author-guidance.md` (Push/pull card, Alt and Flip; Sketch card Flip; red arrow Flip/Escape/typed value). The behavior is recorded in `behavior.md` (provisional lines marked); the ghost and the red arrow are approved. Delete this row once the hand-check passes. The red ghost also shows for Helical sweep, Revolve face, Sweep face, the hole tools and Emboss/Cut along surface (Subtract mode, previews only; Boolean subtract, Cut with plane and the fillets have none), and the red push/pull arrow can be grabbed. Candidate behavior lines are in the commit messages and `docs/decisions-log.md`.

- **Hole Editor.** Owner (2026-10-29): "Start an agent to build the hole super tool card. The separate tools can be their own py files as helpers, but the separate tool buttons in the gui need to go. Similar to face selection opening push/pull, when a hole is selected it should open the hole super tool card. Don't name it that I'm just using that as description. The name will be Hole Editor." Earlier the same day: one panel for holes with a graphical representation of all the ways a fastener hole can be modified and tons of metric and imperial presets; a hole tool that is extremely smart and works on every hole selection. On opening: "For now, open the card like I said. eventually, I'm leaning towards having a constant docked panel on the side that will replace tool cards and their funcionality will get moved into that once its decided." Related items checked: Parked "Holes, parked parts" and "Fold Fill hole / remove boss into the Hole tool" (Fill becomes a section calling the Fill hole helper, which stays for bosses).
  - Rulings (owner, 2026-10-29): no Pattern section (see the next row); bosses are not part of it; Align and Distribute stay for several holes; the card opens on a hole selection in the push/pull card's slot and closes like it; the card's content (header, diagram, sections, presets) is separate from its floating host so it can move into a docked panel later.
  - [ ] Core: classify a selection (new hole on a flat face, one hole, several holes, boss, mixed) so no card opens for bosses or mixed picks.
  - [ ] Presets module (metric and imperial clearance, tap, counterbore, countersink values, verified), separate from the card.
  - [ ] Card shell opens on a hole selection (bore wall, shoulder, cone, rim edge, centre dot, split wall) with the diagram and Shape and Size sections.
  - [ ] Depth, Thread, Move, Fill sections; Align and Distribute for several holes.
  - [ ] New hole: one Hole entry in the drawer and search that waits for a flat face (`toolwaiting.ts`).
  - [ ] Last: remove the drawer, strip, search, palette and icon entries of add_hole, add_counterbore, add_countersink, convert_to_counterbore, convert_to_countersink, edit_hole, thread_hole, align_holes and distribute_holes (the tools stay registered as helpers); pattern_hole, pattern_hole_circular, resize_hole, move_hole and fill_hole keep their buttons.

- **Hole patterns belong to the array tools.** Owner (2026-10-29): "No patterning in the Hole Editor, those should remain in the array tools. If hole patterns existed and the current array tools can't cover the functionality, we need to find a way to merge the hole patterns into the array tools, which means that the array tools need to be able to understand what a hole is, use that as a tool for patterning, and replicate it including its Hole features." Related: Ideas "Stored array parameters" (section 5); decisions-log 2026-10-26 (arrays on features copy round hole walls).
  - [ ] Array tools replicate a hole with its counterbore, countersink and thread.
  - [ ] Then remove the Pattern hole / boss and Circular pattern buttons (kept for now so no capability is lost). Not started.

- **Boss editing needs its own home.** Owner (2026-10-29): "Why are bosses being lumped into hole editor? they're not holes." Resize, Move and Fill hole / boss still serve bosses and keep their buttons; the Move tool will cover moving a boss; no other decision yet.

## Review of 2026-10-27 session A (owner review of author-guidance sketch items; quotes are the owner's words)

Related existing items checked: Ideas "A parity checklist" (its scenario set that must solve without flips touches the sketch flipping row). The rest of this review is built (see the commit log, "Record the sketch review results and rows" onward); what is left:

Tool group SKETCH:

- **Sketch flipping.** Owner: "Unrelated to this line item but I get some sketch flipping if i move not fully constrained profile geometry around abruptly. [Another CAD program] has made a lot of strides recently in mitigating sketch flipping."
  - [ ] Dragging was already solved in steps; the step cap is now 40 instead of 12. Not reproduced: ask for the sketch that flips, then keep the solution nearest the previous one (limit the step or retry from the last good state) and add the case to the no-flip scenario set.
- **Coincident constraint mark.** Owner: "Coincident constraint mark shoul be its tool button icon and be adjacent to the location" (the sentence ends there in the owner's text).
  - [ ] Ask for the rest of the sentence; coincident points have no mark today (only an automatic Coincident row in the list), so a mark at every shared point could crowd the sketch.
- **Equal on arcs and circles (bug).** Owner: "Equal constraint didn't work on arcs or circles but definitely should."
  - [ ] Not reproduced: the button's selection check and the core solver both accept two circles, two arcs, and an arc with a circle, and a core test covers them. Ask for the failing selection (for example an ellipse, a dimensioned radius, or an automatic constraint in the way) and the message shown.

## Review of 2026-10-26 session B (owner review; quotes are the owner's words)

Related existing items checked: Parked/Ideas "Stored array parameters" (arrays stay separate solids; the compound-union row below does not touch it), "Merge Cut with plane and Split with plane" (the Cut with plane card row touches it: keep the two tools separate), "Axis lock keys" and "Mouse-modifier shortcuts" (the measure double-click row touches them).

Tool group CORE (follow-up):

- **Stretch on parts with curved neighbours.** Owner: "Stretch tool doesn't work at all." (Not reproduced on simple solids; a straight flat-end move now falls back to extruding.)
  - [ ] Find the owner's failing case if it recurs; ask for the part.

- **White viewport after a symmetry constraint (bug, high priority: risk of lost work).** Owner: "While sketching I made a symmetry constraint and the entire background turned white and sketch axis origin and sketch geometry cannot be seen but dimensions are still visible. No error reported and otherwise the UI elements are there and allow editing. Clicking finish sketch did not resolve the issue. Refreshing the browser tab fixed, but we cannot rely on refreshing the browser tab which always poses a lost work risk becuase sometimes the project state doesn't restore to latest."
  - [ ] (In progress: not reproduced with two lines about a line or point, a core fuzz of 1500 symmetric sketches gave no NaN; the loop is now guarded and shows a status error if a frame part throws, so the next occurrence names the cause.) Find the cause. Likely a render failure in the 3D view (for example a NaN or invalid value in the symmetry constraint's geometry, or a lost WebGL context) while the HTML dimension labels keep working; check the browser console and the symmetry constraint code path.
  - [ ] Symmetry constraint no longer blanks the viewport; add a test for any bad value found if it can run without a browser.
  - [ ] Separate row if confirmed: the project state does not always restore to the latest after a refresh (owner: "sometimes the project state doesn't restore to latest"). Reproduce and investigate the autosave and restore path.
  - Not reproduced; the solver rejects non-finite solutions and the frame loop is guarded. Next: log renderer info and context state when it happens; check the profile-fill mesh and the dimension overlay for NaN.
  - Owner (2026-10-26): could not reproduce either; will report if it recurs. Leave the guarded frame loop as is.
  - Owner (2026-10-28) saw it again: "I just got the white screen. It happended after I tried to drag the center point of two circles in sketch mode that were both centers coincident to the x-axis and diameter constraints applied and error messsage is "3D view WebGL context failed: The 3D view lost its graphics context; waiting for it to return"". Not reproduced: the solver drags that sketch correctly (any target, up to 1e6), and the same setup in the app drew fine. It is a lost graphics context (the browser's GPU side), which can come from many Pliable tabs or reloads open at once; check whether the view comes back by itself, and whether it recurs after a fresh reload with only one tab. A related fault was found and fixed: the line across a diameter could catch the drag meant for the centre point.
- **Stored array parameters (long term, needs owner feedback).** Store array parameters like primitives (editable later); today arrays make separate solids. Consider an option for the array to be a compound with its source object.

- **Exact B-rep export for .ifc and .3dm.** Owner: "I want to expand the import and export filetypes to include those that oCCT supports such as: .step, .stp, .stpZ, .iges, .igs, .brep, .brp, .ifc. Also investigate potentially supporting .3dm    Via OpenNURBS / openNURBS bindings." All listed formats are built. .ifc export writes faceted B-reps (an imported bracket comes back as many small faces) and .3dm export writes triangle meshes, both labelled lossy.
  - [ ] Exact B-rep export for .ifc (IfcOpenShell's OCC bindings, if a wheel provides them) and for .3dm (the rhino3dm wheels cannot add edges, trims or loops; look for another route such as writing the file with another library); keep the lossy export until then.
- **App split, rest of the architecture plan** (owner allowed it by the hierarchy; one slice per commit with a Chrome check, riskiest last). Done: `main.ts` selection (`selection.ts`, `modelview.ts`, shared state in `appstate.ts`), the drag and preview code (`itemdrag.ts`), the sketch ask strips and solve loop (`sketchasks.ts`, `sketchsolve.ts`). Left: `sketch.ts` pointer handling (onMove, onDown, startDrag, place), projection, editInline/selectDimension (each touches 10+ private fields and has no test; needs a small shared-state object like `appstate.ts` first); `viewport.ts` (not started); then Phase 5 (folders for the flat core files, optional test splitting). Order and rules in [architecture-plan.md](archive/architecture-plan.md).
- **Alpha release:** `v0.3.0` is tagged and its draft release awaits the owner. Do not publish, tag or merge to `main` without the owner's explicit go-ahead each time. The next release series is `v0.4.0` (move to a Tauri local portable install, to last until 1.0). The alpha tool-coverage decision is provisional (every core tool has a test; none hidden or marked experimental).
- **Sketch parity, remaining:** live (non-snapshot) projected edges are not built because edge ids are not stable across model changes (a live edge could silently go stale); shape constraints for ellipses and splines need another solver (the only candidate wheel has no macOS build); control-point splines with weights; hyperbola and parabola arcs. Built: choosing a kept sketch for Array along path and Sweep face, snapping to sketch curves, the View sketch plane.
- **Shared newest-wins preview scheduler** (`app/src/latestwins.ts`): only the hole centre drag uses it; the push/pull drag (`pump`) and form previews (`drainPreviews`) keep their own copies because of extra state; moving them is a risk with no user-visible gain.
- **Holes, parked parts:** sloped or stepped cut walls. Step depth grips, size presets and the Edit cut tool with length and width resize are built.

## Ideas (not built; the owner picks what becomes a row)

Ideas from the local research notes in `docs/research/` (untracked), written in our own words, by behavior only. Nothing here is approved or scheduled. Questions they raise go to [author-guidance.md](author-guidance.md) only if a choice is needed.

- Mouse-modifier shortcuts (owner, 2026-10-24): direct manipulation such as dragging a face is a shortcut for a tool the arrow handle or the tool strip also starts, with the same options; more shortcuts using mouse modifiers are expected, with the modifiers not decided yet.
- Fold Fill hole / remove boss into the Hole tool as a mode later (Defeature fails on blind holes, curved bosses and filleted bosses, so the tool stays for now).
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
