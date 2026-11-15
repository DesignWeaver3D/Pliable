# Progress

Open work only, for the rebuild in [ROADMAP.md](../ROADMAP.md). Read this first in every session. Keep it under about 48 KB: when work is finished, delete its entry (git keeps the history; describe the change in the commit message). Rows have no numbers; the title is the identity.

Where things go: open to-dos here; parked work and not-built ideas in the last two sections here (judge every new row against them, because a related idea may become part of the new task); everything that needs the owner's time (hand-tests, questions, approvals) in [author-guidance.md](author-guidance.md); approved behavior in [behavior.md](behavior.md); decisions in [decisions-log.md](decisions-log.md); shortcuts and guesses in [watchlist.md](watchlist.md); lasting technical notes in [dev-notes.md](dev-notes.md).

State (2026-11-13): `main` is the development branch and the only long-lived one (protected: contributors use pull requests, the owner pushes directly; see CONTRIBUTING.md). `v0.4.3` is the latest version (tagged; its draft release awaits the owner). Hand-checks not yet done are in `author-guidance.md`. Do not use the word MVP. US spelling in user-visible text. Owner decisions in force are in `decisions-log.md`. Do not invent work.

## Planned (not started; discuss before coding)

Tool group CORE:

- **Boss editing needs its own home.** Owner (2026-10-29): "Why are bosses being lumped into hole editor? they're not holes." Resize, Move and Fill hole / boss still serve bosses and keep their buttons; the Move tool will cover moving a boss; no other decision yet.

- **Flip: Apply and an empty click do nothing.** Owner (2026-10-29): "Different bug, when flip is active in Push/Pull card the card's Apply button does nothing and same with clicking in empty 3d space. But the close button still works". Related items checked: the "Push/pull on a sketch face adds or subtracts" row (Flip is part of it); none in Parked or Ideas.
  - [ ] Cause (read, not run): with Flip on, a pull along the normal subtracts, which on a body face removes nothing ("Nothing to subtract" in the status line); a push inward adds a slab that is already solid, so nothing changes and nothing is said. This matches `test_flip_reverses_which_drag_direction_adds_and_subtracts` and `behavior.md`, so no code was changed. Needs the owner's answer in `author-guidance.md` (Decisions).

- **Always-on tool parameter sidebar (discuss; no edits; after the release).** Owner (2026-11-02): "any selection that results in immediate display of gizmos should open the card related to those gizmos", then "I was leaning toward an always on tool parameter sidebar that repopulates contents based on the task at hand. That would be less disruptive than different size cards popping up and closing all the time." Related: "Select first, then use widgets" (this is its panel half), "Push/Pull: Alt toggles..." (card-on-face-click moved here), "Hole Editor". A direct push/pull drag no longer opens the card (`git log --grep "Stop a push/pull"`).
  - [ ] Decide with the owner: scope (Push/Pull and Hole Editor first, then the tool forms; the Measure card floating or a section); a collapsible strip on small screens; the armed tool wins over the selection; whether the direct face drag stays (row "Select first").
  - [ ] Build the panel shell on the right in the card slot and move Push/Pull in (Apply with nothing pending is dimmed, an empty click shows the hint), then the Hole Editor, then the tool forms one at a time; rewrite each `behavior.md` line only as the owner approves.

- **Select first, then use widgets (discuss; no edits).** Owner (2026-10-30), same message as the row above: "I think I may need to follow suite with [another CAD program] concerning immediate Push/Pull and immediate Fillet/Chamfer. Those behaviors are left over from the original PoC and now it seems we really need to make selection first then interact with widgets rather than allow tools to operate directly on faces and edges." This would replace the approved direct drags (dragging a face starts Push/Pull, dragging an edge handle starts Fillet/Chamfer, the always-on edit arrows on holes) with a flow of: select, then use the tool's widget or card. Related existing items checked: Ideas "Mouse-modifier shortcuts" and "Modifier bundles on drag" (they assume a drag on a face is a shortcut), the Hole Editor rows (selection opens the card), the docked-panel idea (a constant side panel replacing tool cards), the drawer rule (any tool can be armed with a selection made before or after).
  - [ ] Inventory every direct manipulation today: face drag (Push/Pull), edge handle (Fillet/Chamfer), hole arrows and center-dot drag, body move handles, sketch region pulls; for each, what the select-first version would be.
  - [ ] Bring the owner a proposal with the cost of each change and the `behavior.md` lines it replaces; no behavior is changed before the owner approves it.

- **Split the large files by job.** Owner (2026-10-31): "make plans for each based on separation of concerns for mudularity and especially for shared functions that should be broken out to keep each individual file laser focused and lean", then: "Determine which of those could be cimbined down to not more than two agents, candidates in which order. And cadidates which should not be worked on in parallel". Related: Parked "App split, rest of the architecture plan" (continued here; it keeps Phase 5).
  - Owner (2026-11-11): "Check the long files for separation of concerns for proper modular code file separation and proceed unnattended to separate those concerns. If you complete that, give the project a once over for best architectural configuration and fix the most glaring issues with the highest ROI for speed, efficiency, and maintainability for AI coding."
  - [ ] `main.ts` (1440 lines) still holds the tool panel's host (preview and commit of a form, about 280 lines with `runPreview`, `drainPreviews`, `twoDistances`) and the command list. They read some 30 module-level values each; moving them needs that state in `appstate.ts` first. Ask the owner before starting.
  - Done (2026-11-15): stand-in node tests cover viewcamera, viewfacedir, viewfit, viewdragmeasure, viewslide, viewpick, viewselection, viewitemdrag and sketchundo, sketchleave, sketchkeydown, sketchconstrain (not `applyConstraint`), sketchtransform, sketchtypedapply. Not covered (need the renderer, DOM, pointer capture or the whole sketch module cycle): viewlook, viewinput, viewboxselect, viewsketchpick, viewsimilarmenu, viewdividedrag, viewcentredrag; sketch panel, bar, render, pointer, dimactions, planemove, project, refresh.
  - Not done, for the owner to pick: folders for the flat `app/src` and core files (Phase 5; prefixes group them today); core tests in parallel (tried with 6 workers: 129 s becomes 75 s and all pass, with 10 a timing test fails; adding the package needs the owner's core stopped).

- **Speed and platform pass.** Owner (2026-11-11): "Work unattended. See if you can find and improve any computational processing time that would result in smoother and faster user experience. Also check for any inconsistencies that might occur between windows (most tested) and linux and macos versions. When you find items in these categories, go ahead and fix them."
  - [ ] `.githooks/commit-msg` and `pre-commit` are not marked executable in git (git on Linux and macOS skips them); the permission rules decline `git update-index --chmod=+x`, so the owner must run it. (`find-python.sh` now falls back to `python3`.)

- **Many-body speed (measured; discuss before coding).** Owner (2026-11-14): "Pliable is very slow to do work or even move bodies when there are many bodies in the project. The performance is worse than [another CAD program]. It makes me very concerned that the cause is the entire application architecture when I originally blamed OCCT. But if [another CAD program] is using  OCCT and can outperform us then the problem must be in our stack. Are we limited to single threaded computation for everything, even when using the portable shell instead of web browser? Is the current application stack funamentally wrong for efficient CAD work that includes very large geometry face and edge counts? Have we been building a CAD application that is fundamentally performance-crippled by its stack architecture?" Measured on the owner's 114-body STEP enclosure (8219 faces, 21693 edges; scripts, outputs and rerun steps in `C:\dev\pliable-wt\perf\`, outside the repo): moving one 9-face body takes about 25 s in the core (20 ms with that body alone), a push/pull about 5.3 s (kernel op 27 ms), every reply is 13-15 MB; the page decodes in about 30 ms and draws the next frame in 340-480 ms. The kernel is not the bottleneck; our whole-project work is. Related: Planned "Speed and platform pass" (its open item is unrelated: hook permissions), "Split the large files by job".
  - Done (2026-11-14): move body measures the whole model only with no body selected; the same-surface merge measures only the bodies holding a merged face; display data is kept per body and rebuilt only for changed bodies (`bodydisplay.py`); a moved body is placed, not copied. Meshing and booleans already ran in parallel. Now (114 bodies): a move in a row of moves about 3.2 s (was 6.3 s), nearly all of it the operation itself (tool, face merge, document push); undo between merged states 0.4 s (was 2 s). Script: `C:\dev\pliable-wt\perf\pc_base.py` (moves in a row without undo; `perf.py` overstates because it undoes to the import each run).
  - Done (2026-11-14, phase 3): Move/Rotate on bodies tells the merge which bodies changed (optional argument; leaving it out keeps the whole-model path, so other callers and Stretch's branch are unchanged); once a whole-model merge leaves the counts unchanged (`mergescope.merge_settled`, the third move after an import on the 114-body model) the same-surface search, kernel merge, topology copy and validity check run on the moved bodies only. Move 5 and later about 0.48 s (was 3.1 s); push/pull on a merged model 0.54 s. Owner checks it in their tab.
  - Done (2026-11-14): loose import faces are surface bodies, so the import state takes the per-body paths; the first edit after an import still changes about 118 bodies in the first whole-model merge (reply 12.5 MB once; the background merge after import does this work early).
  - Done (2026-11-15): push/pull, holes and fillets already merge only their own body (0.00-0.02 s of merge); add hole, Scale body and Offset body use the scoped merge on a merged model (`mergescope.finish_scoped`). Not sped up: a hole in "Other bodies" mode (3-20 s each on the enclosure) changes the body count, so the scoped path does not apply.
  - [ ] A hole with "Other bodies" takes 3-20 s on the enclosure; profile where the time goes (the body count changes, so the scoped merge is skipped).
  - Done (2026-11-14, owner: "Begin 4 when ready.", "approve option B"): replies carry only the changed bodies (core ids stay global; the page store `meshstore.ts` renumbers from per-body counts; full replies on open, import, restore and reconnect; `?dev=1` compares each delta with a full reply). Enclosure: later moves 3.4 MB then 0.08 MB (was 13-15 MB), drag preview 0.66 s, commit 0.49 s, undo 0.36 s.

- **Many-body app path still slow, and gizmo moves sometimes fail (bug).** Owner (2026-11-14), after the speed merges: "The move feels none faster in my tab. The face selection is slow. Selecting the body from the face right-click takes several seconds then another several seconds before the tool buttons rearrange and present the Move/Rotate tool button. Selecting it takes several seconds before the gizmos appear. Moving by gizmo is like 13 seconds and sometimes doesn't succeed (body stays where it was and gizmo resets back)." Likely cause to check first: the enclosure keeps 6 open shells outside any solid, which sends display and the scoped merge to the whole-model path; the measurements used a script, not the app's selection, tool and gizmo requests. Related: "Many-body speed", "Geometry outside any solid in imports".
  - Done (2026-11-14): related-face search on a face click 3.1 s to 0.5 s, tool list for a face 0.9 s to 0.09 s, unmoved bodies' merge reused across a drag's previews (later previews 15 s to 0.5 s, release 16 s to 3 s), a preview settles the merge state; a node test drives the drag with late replies and every case commits. Measured on a copy whose bodies share nothing: as imported, the enclosure's bodies share sub-shapes, so every per-body path (display, scoped merge, merge reuse) stays off there and the owner sees no gain.
  - Done (2026-11-14, owner: "I agree with all three."): the merge reuse counts surface bodies like the operations do (the bodies never shared sub-shapes; the mismatch came from merging the surface body and speed branches together), so on the enclosure as imported later drag previews take 0.5 s (was ~15 s) and a release 3.3 s (was 16 s); the crash backup is written 1.5 s after the last change (at most 5 s) and on disconnect and shutdown; after an import the whole-model merge runs in the background, so the first drag takes 3.9 s if the user waits about 15 s (14.6 s without waiting), while queries in that window can be slower (one went from 0.5 s to 5.3 s).
  - Done (2026-11-14): the merge memory carries over a commit when the model was already marked merged; first drag after a push/pull 0.66 s (was 3-4 s).
  - Done (2026-11-14): a body's preview and full display are made from each other (they differ only in edge normals): arming Move/Rotate 4.0 s to about 0.6 s, release after a drag 3.3 s to 2.2 s (edge-normal calls 1.3 s of it). The first preview of a drag (3.9 s) builds the bodies the merge changed.
  - [ ] Failing gizmo move not reproduced (core moves always succeed). Suspect: a draw error on a 15 MB reply is caught like a failed request and redraws the old mesh. Asked the owner for the browser console text the next time it happens. Replies are now small (deltas), which may remove the suspected cause.
- **Duplicate-code follow-ups (possible bugs found by the cleanup).** Owner (2026-10-31): "orchestrate a research agent to identify similar redundant code elsewhere in the code base that are not using shared modules". Left as findings, behavior unchanged:
  - Done (2026-11-15): the half-turn range comment is corrected; the snap distances and tolerances were checked and are deliberate (separate systems and scales).
  - [ ] A typed 180 degree arc: the committed arc (`sketchtypeddims.ts` about 97-99) goes clockwise and takes the pointer's side above 180, while the preview (`sketchpreview.ts`) always goes counterclockwise. Decided (hierarchy): the preview follows the committed rule so what is shown is what is made; test.
  - [ ] A zero turn is a zero-length arc in `arcBetween` but a full circle in `positiveSweep`; check which tools reach each with a zero turn and make them agree with each tool's own tests.
- **Next work from the roadmap and research (added 2026-11-15, unattended; not asked for).** The open rows above all wait on the owner, so these come from ROADMAP.md and `docs/research/` (pull-move workflows, workflow comparison, holes scope, sketcher parity). Related items checked: none in Parked or Ideas. Each is checked against `docs/behavior.md` before building.
  - [ ] Non-uniform scale of a body (separate X, Y, Z factors; `tools/scale_body.py` takes one factor today).
  - [ ] Copy while pushing or pulling: a toggle that leaves the original face's body and makes the pushed result a new body.
  - [ ] Extrude an edge into a surface (a surface body from a model edge along a direction).
  - [ ] Stretch a round hole into a slot from the Hole Editor.
  - [ ] Sketch: join connected curves into one.

- **Sketch clicks that only set a size.** Owner (2026-10-31): "Similar need applied to circle by 3 points and check the rest of the sketch geometry tools for similar", and "Apply the same to arc by center end click." Related existing items checked: none in Parked or Ideas. Built for the slot, circle, 3-point circle and arc, polygon, ellipse and arc-by-center clicks that land on a point, curve or axis.
  - [ ] An arc-by-center end click anywhere else only sets the angle, and an ellipse third click off the minor axis sets only the short radius; both need a constraint the solver does not have (collinear with the center, tangent to the ellipse). Ask the owner whether they are wanted.

- **Sketch fillet and chamfer keep the corner.** Owner (2026-10-30): "when a fillet or chamfer is appied the original vertex needs to be conserved in case it has constraints on it ... Applying a fillet caused the existing dimensions to only apply to the straight edge and the radius of the fillet increased the size of the rectangle in both directions. [another CAD program] does this by keeping fully constrained construction lines in the portion of both lines that are truncated". Built for two lines (`roundCorner`): the old lines and the corner stay whole as construction; new lines and the arc or bevel make the outline, held on them (a solver check of a dimensioned rectangle keeps its size, zero freedom left).
  - [ ] Corners with an arc (`sketchcornercurves.ts`) still replace the vertex; do the same there once the owner has seen the two-line result.

- **Apply button does nothing (not reproduced).** Owner (2026-10-30): "Sketch card & push pull apply button doesn't work." Checked in the app on a spare port: the Push/Pull card's Apply commits a typed distance on a body face and on a picked sketch region, and the Move/Rotate form's Apply moves a sketch picked from the list or by its region. What does nothing: Apply on the Push/Pull card with no distance typed (`pushpullcard.ts` `apply`). Need from the owner: the exact steps (which card, what was typed or dragged, what the status line said).
  - [ ] Reproduce with the owner's steps, fix, add a test where no browser is needed.

- **Sketch flipping.** Owner: "Unrelated to this line item but I get some sketch flipping if i move not fully constrained profile geometry around abruptly. [Another CAD program] has made a lot of strides recently in mitigating sketch flipping."
  - [ ] Dragging was already solved in steps; the step cap is now 40 instead of 12. Not reproduced: ask for the sketch that flips, then keep the solution nearest the previous one (limit the step or retry from the last good state) and add the case to the no-flip scenario set.
- **Equal on arcs and circles (bug).** Owner: "Equal constraint didn't work on arcs or circles but definitely should."
  - [ ] Not reproduced: the button's selection check and the core solver both accept two circles, two arcs, and an arc with a circle, and a core test covers them. Ask for the failing selection (for example an ellipse, a dimensioned radius, or an automatic constraint in the way) and the message shown.

## Review of 2026-10-26 session B (owner review; quotes are the owner's words)

Related existing items checked: Parked/Ideas "Stored array parameters" (arrays stay separate solids; the compound-union row below does not touch it), "Merge Cut with plane and Split with plane" (the Cut with plane card row touches it: keep the two tools separate), "Axis lock keys" and "Mouse-modifier shortcuts" (the measure double-click row touches them).

Tool group CORE (follow-up):


- **White viewport after a symmetry constraint (bug, high priority: risk of lost work).** Owner: "While sketching I made a symmetry constraint and the entire background turned white and sketch axis origin and sketch geometry cannot be seen but dimensions are still visible. No error reported and otherwise the UI elements are there and allow editing. Clicking finish sketch did not resolve the issue. Refreshing the browser tab fixed, but we cannot rely on refreshing the browser tab which always poses a lost work risk becuase sometimes the project state doesn't restore to latest."
  - [ ] (In progress: not reproduced with two lines about a line or point, a core fuzz of 1500 symmetric sketches gave no NaN; the loop is now guarded and shows a status error if a frame part throws, so the next occurrence names the cause.) Find the cause (likely a 3D render failure such as a NaN or a lost WebGL context while the dimension labels keep working).
  - [ ] Symmetry constraint no longer blanks the viewport; add a test for any bad value found if it can run without a browser.
  - [ ] Separate row if confirmed: the project state does not always restore to the latest after a refresh (owner: "sometimes the project state doesn't restore to latest"). Reproduce and investigate the autosave and restore path.
  - Owner (2026-10-26): could not reproduce either; will report if it recurs. Leave the guarded frame loop as is.
  - Owner (2026-10-28) saw it again: "I just got the white screen. It happended after I tried to drag the center point of two circles in sketch mode that were both centers coincident to the x-axis and diameter constraints applied and error messsage is "3D view WebGL context failed: The 3D view lost its graphics context; waiting for it to return"". Not reproduced: the solver drags that sketch correctly and the app drew it fine. It is a lost graphics context (GPU side), possibly from many open tabs; check whether the view returns by itself and whether it recurs with one tab. Fixed on the way: the line across a diameter could catch the drag meant for the centre point.
- **Stored array parameters (long term, needs owner feedback).** Store array parameters like primitives (editable later); today arrays make separate solids. Consider an option for the array to be a compound with its source object.

- **Exact B-rep export for .ifc and .3dm.** Owner: "I want to expand the import and export filetypes to include those that oCCT supports such as: .step, .stp, .stpZ, .iges, .igs, .brep, .brp, .ifc. Also investigate potentially supporting .3dm    Via OpenNURBS / openNURBS bindings." All listed formats are built. .3dm export writes triangle meshes (labelled lossy).
  - Done (2026-11-15): .ifc export writes exact advanced B-reps (`filesifcexact.py`: planes, cylinders, spheres, tori, B-splines, cones as rational B-splines; faceted for a solid with a pole or several shells), no new dependency.
  - Parked (2026-11-15): exact .3dm export. The available wheels cannot add edges, trims or loops and no other library has B-rep classes; the only route without a dependency is writing the B-rep archive bytes by hand (reverse-engineering the format), judged too risky. Meshes stay.
- **App split, rest of the architecture plan** (owner allowed it by the hierarchy; one slice per commit with a Chrome check, riskiest last). Done: `main.ts` selection (`selection.ts`, `modelview.ts`, shared state in `appstate.ts`), the drag and preview code (`itemdrag.ts`), the sketch ask strips and solve loop (`sketchasks.ts`, `sketchsolve.ts`). Left: see the Planned row "Split the large files by job"; then Phase 5 (folders for the flat core files, optional test splitting). Order and rules in [architecture-plan.md](archive/architecture-plan.md).
- **Alpha release:** releases follow the checklist in CONTRIBUTING.md; the owner publishes each draft release by hand. Do not publish, tag or merge to `main` without the owner's explicit go-ahead each time. The next release series is `v0.4.0` (move to a Tauri local portable install, to last until 1.0). The alpha tool-coverage decision is provisional (every core tool has a test; none hidden or marked experimental).
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
- Next wave, not started (owner, 2026-10-31): after sketch workflow fluidity and bug fixing, a curve and surface (NURBS) workflow with true 3D sketching, drawing on the direct-modeling and curve tools of the open-source parametric modeler's add-ins. Concept and the owner's words are in the local `docs/research/nurbs-wave.md`; do not research or build until the owner says the wave starts.
- Long term (owner, 2026-10-31): repair or flag geometry errors when importing STEP files, so a broken body does not arrive silently unusable. Related Parked items: none found.
- Formulas, next steps (owner, 2026-11-01): numbers, + - * / ^, unary signs and brackets already work in number fields, dimension values, gizmo typing and sketch-size typing. Not built: functions, pi, units, percent, implicit multiplication, named values and dimensions, keeping the formula beside its value (evaluated in the core), and decimal-comma text built by the core. Related Parked items: none found.

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
- **Merge free-form faces on one surface.** Two B-spline faces whose surfaces coincide (sample points within the merge length, outward normals agreeing) are left as two faces; joining them would reuse the volume and area check per group. Out of scope by decision (decisions-log 2026-11-14); two such pairs are in the owner's mirror model.

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
