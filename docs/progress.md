# Progress

Open work only, for the rebuild in [ROADMAP.md](../ROADMAP.md). Read this first in every session. Keep it under about 48 KB: when work is finished, delete its entry (git keeps the history; describe the change in the commit message). Rows have no numbers; the title is the identity.

Where things go: open to-dos here; parked work and not-built ideas in the last two sections here (judge every new row against them, because a related idea may become part of the new task); everything that needs the owner's time (hand-tests, questions, approvals) in [author-guidance.md](author-guidance.md); approved behavior in [behavior.md](behavior.md); decisions in [decisions-log.md](decisions-log.md); shortcuts and guesses in [watchlist.md](watchlist.md); lasting technical notes in [dev-notes.md](dev-notes.md).

State (2026-11-09): `main` is the development branch and the only long-lived one (protected: contributors use pull requests, the owner pushes directly; see CONTRIBUTING.md). `v0.4.2` is the latest version. Hand-checks not yet done are in `author-guidance.md`. Do not use the word MVP. US spelling in user-visible text. Owner decisions in force are in `decisions-log.md`. Do not invent work.

## Planned (not started; discuss before coding)

Tool group CORE:

- **Hole patterns belong to the array tools.** Owner (2026-10-29): "No patterning in the Hole Editor, those should remain in the array tools. If hole patterns existed and the current array tools can't cover the functionality, we need to find a way to merge the hole patterns into the array tools, which means that the array tools need to be able to understand what a hole is, use that as a tool for patterning, and replicate it including its Hole features." Related: Ideas "Stored array parameters" (section 5); decisions-log 2026-10-26 (arrays on features copy round hole walls).
  - [ ] Array tools replicate a hole with its counterbore, countersink and thread.
  - [ ] Then remove the Pattern hole / boss and Circular pattern buttons (kept for now so no capability is lost). Not started.

- **Boss editing needs its own home.** Owner (2026-10-29): "Why are bosses being lumped into hole editor? they're not holes." Resize, Move and Fill hole / boss still serve bosses and keep their buttons; the Move tool will cover moving a boss; no other decision yet.

- **Flip: Apply and an empty click do nothing.** Owner (2026-10-29): "Different bug, when flip is active in Push/Pull card the card's Apply button does nothing and same with clicking in empty 3d space. But the close button still works". Related items checked: the "Push/pull on a sketch face adds or subtracts" row (Flip is part of it); none in Parked or Ideas.
  - [ ] Cause (read, not run): with Flip on, a pull along the normal subtracts, which on a body face removes nothing ("Nothing to subtract" in the status line); a push inward adds a slab that is already solid, so nothing changes and nothing is said. This matches `test_flip_reverses_which_drag_direction_adds_and_subtracts` and `behavior.md`, so no code was changed. Needs the owner's answer in `author-guidance.md` (Decisions).

- **Share one volume helper in the core.** Owner (2026-10-30): "Make a progress line for that cleanup candidate". Done: `volume.py` (`volume_props`, `volume_of`) is used by `bodies.py` (absolute value), `files.py`, `ops.py`, `measurebody.py` and `measure.py`. Related existing items checked: none in Parked or Ideas.
  - [ ] `shared/solids.py` `_volume` and the test helpers (about 15 test files call `BRepGProp.VolumeProperties_s` directly) still have their own copies; move them onto `volume_of`, keeping every result and test tolerance the same.
  - [ ] Decide the sign: only `bodies.py` takes the absolute value; the others return a negative volume for a reversed solid, and `ops.py` compares volumes in push/pull and mirror. Check whether a reversed body can reach those comparisons; report to the owner before changing any result.
- **Always-on tool parameter sidebar (discuss; no edits; after the release).** Owner (2026-11-02): "any selection that results in immediate display of gizmos should open the card related to those gizmos", then "I was leaning toward an always on tool parameter sidebar that repopulates contents based on the task at hand. That would be less disruptive than different size cards popping up and closing all the time." Related: "Select first, then use widgets" (this is its panel half), "Push/Pull: Alt toggles..." (card-on-face-click moved here), "Hole Editor". A direct push/pull drag no longer opens the card (`git log --grep "Stop a push/pull"`).
  - [ ] Decide with the owner: scope (Push/Pull and Hole Editor first, then the tool forms; the Measure card floating or a section); a collapsible strip on small screens; the armed tool wins over the selection; whether the direct face drag stays (row "Select first").
  - [ ] Build the panel shell on the right in the card slot and move Push/Pull in (Apply with nothing pending is dimmed, an empty click shows the hint), then the Hole Editor, then the tool forms one at a time; rewrite each `behavior.md` line only as the owner approves.

- **Select first, then use widgets (discuss; no edits).** Owner (2026-10-30), same message as the row above: "I think I may need to follow suite with [another CAD program] concerning immediate Push/Pull and immediate Fillet/Chamfer. Those behaviors are left over from the original PoC and now it seems we really need to make selection first then interact with widgets rather than allow tools to operate directly on faces and edges." This would replace the approved direct drags (dragging a face starts Push/Pull, dragging an edge handle starts Fillet/Chamfer, the always-on edit arrows on holes) with a flow of: select, then use the tool's widget or card. Related existing items checked: Ideas "Mouse-modifier shortcuts" and "Modifier bundles on drag" (they assume a drag on a face is a shortcut), the Hole Editor rows (selection opens the card), the docked-panel idea (a constant side panel replacing tool cards), the drawer rule (any tool can be armed with a selection made before or after).
  - [ ] Inventory every direct manipulation today: face drag (Push/Pull), edge handle (Fillet/Chamfer), hole arrows and center-dot drag, body move handles, sketch region pulls; for each, what the select-first version would be.
  - [ ] Bring the owner a proposal with the cost of each change and the `behavior.md` lines it replaces; no behavior is changed before the owner approves it.

- **Split the large files by job.** Owner (2026-10-31): "make plans for each based on separation of concerns for mudularity and especially for shared functions that should be broken out to keep each individual file laser focused and lean", then: "Determine which of those could be cimbined down to not more than two agents, candidates in which order. And cadidates which should not be worked on in parallel". Related: Parked "App split, rest of the architecture plan" (continued here; it keeps Phase 5).
  - Owner (2026-11-11): "Check the long files for separation of concerns for proper modular code file separation and proceed unnattended to separate those concerns. If you complete that, give the project a once over for best architectural configuration and fix the most glaring issues with the highest ROI for speed, efficiency, and maintainability for AI coding."
  - [ ] `main.ts` (1440 lines) still holds the tool panel's host (preview and commit of a form, about 280 lines with `runPreview`, `drainPreviews`, `twoDistances`) and the command list. They read some 30 module-level values each; moving them needs that state in `appstate.ts` first. Ask the owner before starting.
  - [ ] No stand-in tests exist for the moved view and sketch modules; the `view*.ts` contexts are narrow `Pick<Viewport, ...>` types, so a test can pass a plain object (pattern: `tests/sketchclicks.test.mjs`). The sketch modules take the whole `SketchMode` (they call one another in a cycle).
  - Not done, for the owner to pick: folders for the flat `app/src` and core files (Phase 5; prefixes group them today); core tests in parallel (tried with 6 workers: 129 s becomes 75 s and all pass, with 10 a timing test fails; adding the package needs the owner's core stopped).

- **Speed and platform pass.** Owner (2026-11-11): "Work unattended. See if you can find and improve any computational processing time that would result in smoother and faster user experience. Also check for any inconsistencies that might occur between windows (most tested) and linux and macos versions. When you find items in these categories, go ahead and fix them."
  - [ ] `.githooks/commit-msg` and `pre-commit` are not marked executable in git (git on Linux and macOS skips them) and `find-python.sh` falls back to `python`, not `python3`. The permission rules declined the edit: `git update-index --chmod=+x` on both, plus a `python3` fallback.

- **Box selection logs a measurement error (seen 2026-11-11, not asked for).** A box that takes faces, edges and vertices together makes the core answer "measure one kind of item at a time" (`measure.py`), which the page writes to the console as a failure on every such box. Nothing visible breaks. Ask the owner whether a mixed selection should simply show no measurement.

- **Duplicate-code follow-ups (possible bugs found by the cleanup).** Owner (2026-10-31): "orchestrate a research agent to identify similar redundant code elsewhere in the code base that are not using shared modules". Left as findings, behavior unchanged:
  - [ ] The short-way angle helpers return [-pi, pi), not (-pi, pi] as a comment says; a typed arc exactly opposite its start flips from -pi to +pi in the preview. A zero turn is a zero-length arc in `arcBetween` but a full circle in `positiveSweep`. Decide what each tool wants, test, then align.
  - [ ] `SNAP_PX` is 10 in `sketchsnap.ts` and 12 in `reference.ts`; `symmetric.TOLERANCE` is 1e-3, `holes`/`voids`/`relations` 1e-5, `unwrap`/`splitwalls` 1e-6. Confirm each is deliberate.

- **Sketch clicks that only set a size.** Owner (2026-10-31): "Similar need applied to circle by 3 points and check the rest of the sketch geometry tools for similar", and "Apply the same to arc by center end click." Related existing items checked: none in Parked or Ideas. Built for the slot, circle, 3-point circle and arc, polygon, ellipse and arc-by-center clicks that land on a point, curve or axis.
  - [ ] An arc-by-center end click anywhere else only sets the angle, and an ellipse third click off the minor axis sets only the short radius; both need a constraint the solver does not have (collinear with the center, tangent to the ellipse). Ask the owner whether they are wanted.

- **Sketch fillet and chamfer keep the corner.** Owner (2026-10-30): "when a fillet or chamfer is appied the original vertex needs to be conserved in case it has constraints on it ... Applying a fillet caused the existing dimensions to only apply to the straight edge and the radius of the fillet increased the size of the rectangle in both directions. [another CAD program] does this by keeping fully constrained construction lines in the portion of both lines that are truncated". Built for two lines (`roundCorner`): the old lines and the corner stay whole as construction; new lines and the arc or bevel make the outline, held on them (a solver check of a dimensioned rectangle keeps its size, zero freedom left).
  - [ ] Corners with an arc (`sketchcornercurves.ts`) still replace the vertex; do the same there once the owner has seen the two-line result.

- **Apply button does nothing (not reproduced).** Owner (2026-10-30): "Sketch card & push pull apply button doesn't work." Checked in the app on a spare port: the Push/Pull card's Apply commits a typed distance on a body face and on a picked sketch region, and the Move/Rotate form's Apply moves a sketch picked from the list or by its region. What does nothing: Apply on the Push/Pull card with no distance typed (`pushpullcard.ts` `apply`). Need from the owner: the exact steps (which card, what was typed or dragged, what the status line said).
  - [ ] Reproduce with the owner's steps, fix, add a test where no browser is needed.

- **Linux AppImage build.** Owner (2026-10-30): "Is the linux build an appimage?" The answer was no (a portable `.zip` from `scripts/build_desktop.py`; `bundle.active` is false in `desktop/src-tauri/tauri.conf.json`), and the owner then asked for it to be added to the plan. Related Parked/Ideas items checked: Parked "Alpha release" (the `v0.4.0` series is the Tauri portable build); nothing else touches it.
  - Owner (2026-10-30, high priority): "our linux releases become AppImage". Built (not run, no Linux machine here): on Linux `scripts/build_desktop.py` makes `pliable-desktop-linux-x64.AppImage` instead of the zip (AppDir, pinned appimagetool, no FUSE needed to build); Windows and macOS keep the zip; the release and desktop workflows smoke-test it with `APPIMAGE_EXTRACT_AND_RUN=1` under xvfb and attach it to the draft release; the shell writes its data to `~/.local/share/pliable` inside an AppImage (the AppImage is read-only). The web view stays the system's WebKitGTK (not bundled); notice updated.
  - [ ] Add a note to the README about the Linux download (a file to make executable and run; needs WebKitGTK 4.1 installed).

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
  - [ ] (In progress: not reproduced with two lines about a line or point, a core fuzz of 1500 symmetric sketches gave no NaN; the loop is now guarded and shows a status error if a frame part throws, so the next occurrence names the cause.) Find the cause (likely a 3D render failure such as a NaN or a lost WebGL context while the dimension labels keep working).
  - [ ] Symmetry constraint no longer blanks the viewport; add a test for any bad value found if it can run without a browser.
  - [ ] Separate row if confirmed: the project state does not always restore to the latest after a refresh (owner: "sometimes the project state doesn't restore to latest"). Reproduce and investigate the autosave and restore path.
  - Owner (2026-10-26): could not reproduce either; will report if it recurs. Leave the guarded frame loop as is.
  - Owner (2026-10-28) saw it again: "I just got the white screen. It happended after I tried to drag the center point of two circles in sketch mode that were both centers coincident to the x-axis and diameter constraints applied and error messsage is "3D view WebGL context failed: The 3D view lost its graphics context; waiting for it to return"". Not reproduced: the solver drags that sketch correctly and the app drew it fine. It is a lost graphics context (GPU side), possibly from many open tabs; check whether the view returns by itself and whether it recurs with one tab. Fixed on the way: the line across a diameter could catch the drag meant for the centre point.
- **Stored array parameters (long term, needs owner feedback).** Store array parameters like primitives (editable later); today arrays make separate solids. Consider an option for the array to be a compound with its source object.

- **Exact B-rep export for .ifc and .3dm.** Owner: "I want to expand the import and export filetypes to include those that oCCT supports such as: .step, .stp, .stpZ, .iges, .igs, .brep, .brp, .ifc. Also investigate potentially supporting .3dm    Via OpenNURBS / openNURBS bindings." All listed formats are built. .ifc export writes faceted B-reps (an imported bracket comes back as many small faces) and .3dm export writes triangle meshes, both labelled lossy.
  - [ ] Exact B-rep export for .ifc (IfcOpenShell's OCC bindings, if a wheel provides them) and for .3dm (the rhino3dm wheels cannot add edges, trims or loops; look for another route such as writing the file with another library); keep the lossy export until then.
- **App split, rest of the architecture plan** (owner allowed it by the hierarchy; one slice per commit with a Chrome check, riskiest last). Done: `main.ts` selection (`selection.ts`, `modelview.ts`, shared state in `appstate.ts`), the drag and preview code (`itemdrag.ts`), the sketch ask strips and solve loop (`sketchasks.ts`, `sketchsolve.ts`). Left: see the Planned row "Split the large files by job"; then Phase 5 (folders for the flat core files, optional test splitting). Order and rules in [architecture-plan.md](archive/architecture-plan.md).
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
