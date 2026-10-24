# Progress

Open work only, for the rebuild in [ROADMAP.md](../ROADMAP.md). Read this first in every session. Keep it under about 10 KB: when work is finished, delete its entry (git keeps the history; describe the change in the commit message). Rows have no numbers; the title is the identity. Lasting technical notes are in [dev-notes.md](dev-notes.md). Other files: [behavior.md](behavior.md), [watchlist.md](watchlist.md), [decisions-log.md](decisions-log.md), [questions.md](questions.md), [protocol.md](protocol.md), [testing-checklist.md](testing-checklist.md), [architecture-plan.md](architecture-plan.md).

New rows quote the owner's request in their own words, then list what it needs as a checklist. A row is deleted only when every checklist item is verified against the quote.

State (2026-10-24): `dev` is many local commits ahead of `origin/dev`, nothing pushed. Run the tests first (`uv run pytest` in `core/`, `npm test`, `npx tsc --noEmit`, `npm run build` in `app/`). The owner's core on 8770 needs a restart (core files changed). Owner decisions in force: first alpha release deferred (no tag); sketch automatic constraints off by default; grid off by default; sketch geometry stays separate from the model (Finish sketch adds no faces); kept sketches persist (see `decisions-log.md`). Do not invent work; ask the owner for hand-test results or new requests.

## Planned (not started; discuss before coding)

Sketch requests (owner, 2026-10-24), one row each, in this order:


- **One push/pull path.** Push/pull from the face arrow handle and from dragging the face directly must be the same tool with the same options (measure pick M, typed values, Shift symmetric, companion faces). Today they are separate code paths (`viewport.ts` face-press drag vs `manipulator.ts` handle drag; M and measure edges exist only on the face press). Make one path; the direct drag becomes a thin shortcut layer that can take more shortcuts later (mouse modifiers, not decided yet). Plan only until the owner says go.
- **Array gizmos.** The linear array becomes a multi-linear array (two directions): one grip for the spacing in each direction and a third grip that sets rows and columns together; default 3 rows by 3 columns.
- **Array apply or discard.** Editing the source primitive of an array made the array disappear (it had not been applied). Clicking outside an array being edited prompts: apply or discard. Possibly later: apply automatically.
- **Stored array parameters (long term, needs owner feedback).** Store array parameters like primitives (editable later); today arrays make separate solids. Consider an option for the array to be a compound with its source object.

## Awaiting the owner's hand test

Built, unit tested, not hand-checked in the app unless noted. Delete a line once the owner has tested it.

- Sketch: dimensions (card has no constraint buttons, strip uses the full width and never greys buttons, entry on creation applies, dimensions drag by text or lines, new ones go outside closed faces, circle centre selectable under a diameter or radius dimension; circle-leader placement inside a larger face not checked); every dimension editable by double-click; dimension appears at once with the value prefilled; horizontal and vertical on multiple lines as detected; coincident for several vertices and vertex-on-edge; smart tangent or collinear; smart dimension; visual-only faces as soon as a profile closes; leaders in the shared off-white; key instructions as a hint; coloured axis edges on the XY, XZ, YZ buttons; sketch geometry draws over the origin axes; dragging a dimensioned horizontal line freely; constraints that need edges ignore selected vertices; gizmo off by default; constraint row on its own second row of the top strip (applying from it not checked); sketch card layout.
- Sketch drawing: typed sizes with Tab for rectangle, slot, ellipse, arc, line, circle, polygons (slot, ellipse and arc sizes are not kept as dimensions); every drawing tool but Line leaves to Select after its first shape (spline after closing or Enter; point after one point).
- Sketch zoom to fit: the nav cube's fit everything and fit selection use the edited sketch's geometry (the fit-selection button enables with a sketch selection).
- Sketch view button: switches to orthographic and back to the earlier mode when the camera is turned (not hand-checked; the 0.99985 direction threshold is about 1 degree).
- Sketch Delete on selected vertices: removes the coincidence and keeps the lines (a lone free end is still deleted with its line).
- Sketch constraint list: shared end points listed as automatic Coincident rows (x splits them); list filtered by the selection.
- Sketch dimension value patch: background patch behind every sketch dimension value (check on a diameter leader and an angle tag, and over a tinted face).
- Sketch point drag: a dragged point snaps to the grid (when on), the axes and the lines of other points (with guides), but never joins another point; Horizontal and Vertical on a single line now add their constraint (the former open bug).
- Sketch planes and regions: faces from areas enclosed by geometry without shared end points (divider across a rectangle, lines attached to a side); offset and angled planes from a flat face, plane tangent to a face at a vertex (angle turns about the face plane's x axis); clicking a kept sketch's tinted region adds it as a selected face (push/pull, pocket, Revolve face, Sweep, Loft); clicking one opens its extrude dialog; grid drawn per pixel (jiggle during a camera glide); grid-off lock-up not reproduced (needs exact steps); slot unconstrainable not reproduced; sketch lift of the alpha "unsupported" label.
- Selection and UI: box-drag filters F, E, V with badge; Select similar; Select parent bodies (wording provisional); edge centres as snap points (not selectable yet); bodies list moved right and scrolls to the picked body; top bar sizes; edit cards under the nav cube group (measurement card dodge not seen); hints stay until Got it; old sketch key tips removed; search keywords, recents, searchable settings, Getting started card, touch sizing, printable shortcut sheet (needs a real touch device; review the icons).
- Modeling: Cut with plane (any direction, keep both halves); counterbore and countersink at either or both ends; Shift toggles symmetric push/pull mid-drag (provisional); primitive handles (stems point inward, only the cube or arrowhead grabs); Model info for the selected body; "new body" box label; datum planes; Mirror mode; symmetric push/pull about a sketch plane, mid-plane or datum; project save and open `.plbl` (restart the core first; stale core caused "Unknown request type"); refresh resumes the open model before any crash prompt (not tried with two cores); many-body speed (150 bodies about 0.3 s per commit); rotation gizmos sized to 50% of the viewport.
- Not reproduced, retest on a restarted core: opening the block model while a 109-solid STEP was loaded took over 150 s (core measured 10 ms).
- Earlier hand-test lists with specific unchecked items: snapping to a ghosted body's edge, Normal-to-edge sketch plane, rotation rings typed degrees, Material choices other than ABS, gloss on a 100k-triangle model, Mirror, Rotate and Scale prompts, circle of copies, split, three-point arc and circle previews, plane through points, kept curve drawing over the model, renaming and deleting a kept sketch, typed negative sign.

## Parked or owner-dependent

- **App split, rest of the architecture plan** (needs the owner's go-ahead and a Chrome check per slice, riskiest last): `main.ts` selection (`setSelection`, `show`, `setCommitted`) then the drag and preview state machine (`pump`, `drainPreviews`, dimension label); `sketch.ts` pointer handling, solve loop, projection and dimension dialogs; `viewport.ts` (not started); then Phase 5 (folders for the flat core files, optional test splitting). Remaining `main.ts` and `sketch.ts` code shares module-level state, so the next slice needs a small shared-state object or explicit getters, a design choice the owner should confirm first. Order and rules in [architecture-plan.md](architecture-plan.md).
- **Alpha release:** portable build is built and CI-verified; the owner deferred the first release, do not tag or publish. The alpha tool-coverage decision is provisional (every core tool has a test; none hidden or marked experimental).
- **Sketch parity:** profile faces cannot yet be picked or dragged with the push/pull arrow; sketch curves are not selectable or snappable; shape constraints for ellipses and splines need another solver (the only candidate wheel has no macOS build); control-point splines with weights; hyperbola and parabola arcs; live (non-snapshot) projected edges; kept sketches not yet usable as sweep rails or array paths.
- **Shared newest-wins preview scheduler** (`app/src/latestwins.ts`): only the hole centre drag uses it; the push/pull drag (`pump`) and form previews (`drainPreviews`) keep their own copies because of extra state; moving them is a risk with no user-visible gain.
- **Holes, parked parts:** non-round through voids (squares, slots) getting move, resize and depth handles; draggable depth grips for counterbore and countersink steps (numbers for now); threads; standard size tables.
- **Cut with plane, parked parts:** choosing the half by two special colours; a movable on-screen plane; creating the plane from a face, three points, edge and point, or offset or angle (the core builders exist, the tool still takes numbers).
- **Selection:** make a hole's centre a selectable item of its own (the dots still pick the hole's face); conical mouths.

## Backlog ideas (not built)

More ideas, with their status, are in [future-ideas.md](future-ideas.md); the questions they raise are in [questions.md](questions.md).

- Mouse-modifier shortcuts (owner, 2026-10-24): direct manipulation such as dragging a face is a shortcut for a tool the arrow handle or the tool strip also starts, with the same options; more shortcuts using mouse modifiers are expected, with the modifiers not decided yet.
- Merge Cut with plane and Split with plane into one tool with a keep option, and let the plane come from a selected face (owner question pending).
- Materials: a per-body material picker and a mass display (density is stored in `app/src/materials.ts`, unused); materials are one global setting now.
- Sweep along a rail and arrays along a path using kept sketch curves.
- Imperial units: lengths are millimetres through `LENGTH_UNIT` in `app/src/units.ts`; grid spacing and dimensions should follow a unit setting later.
- Per-body see-through is view-only per session; it is not saved with the document.
- Long term: design-intent behavior tied to the auto-chip selections, such as which face moves when a face-to-face distance is edited in place (owner, 2026-10-20: deferred).
- Long term: named values and expressions in sketch dimensions (owner, 2026-10-20: numbers only for now).
