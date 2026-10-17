# Rebuild Progress Log

Working log for the rebuild described in [ROADMAP.md](../ROADMAP.md). Read this first in every session (see the local session guide for the session rules).

## Session plan to the MVP

Each session is scoped to fit comfortably in one usage window using Sonnet with a fresh conversation. Each ends with tests passing, this file updated, and a push. **Checkpoint** sessions end with a report to the user, and work doesn't continue until the user responds.

The MVP target is parity with the `v0.1.0-poc` prototype: STEP import/export, face/edge/vertex selection, push/pull with live preview and exact entry, fillet/chamfer by dragging, undo/redo.

| # | Milestone | Goal | Done when | Status |
|---|---|---|---|---|
| S0 | 0 Spike | Python core, tests, headless benchmark | Core tests pass; benchmark recorded below | Done |
| S1 | 0 Spike | Fast tessellation | Gate relaxed by user: bracket/block previews fast; stress model stays ~1.5 s mesh (see findings) | Done |
| S2 | 0 Spike | Frontend scaffold: Vite + TypeScript + Three.js in `app/`, WebSocket client, open a demo, render faces and edges, orbit/pan/zoom | Bracket demo renders in the browser (verified by screenshot) | Done |
| S3 | 0 Spike | Face picking: hover and selection highlight using the face ranges from the mesh | Hovering and clicking faces highlights the right face | Done |
| S4 | 0 Spike | Push/pull drag: drag axis from the face normal, live preview with one request in flight (latest wins), commit on release, Escape cancels, undo/redo buttons, latency readout | Dragging the bracket's top face previews and commits; undo works | Done |
| S5 | 0 Spike | STEP open/export in the UI; measure end-to-end drag latency on all demos; write the checkpoint report | **Checkpoint 1:** report latency numbers and a go/no-go recommendation to the user | Done, awaiting user |
| S6 | 1 Core | Tool API (declarative tool classes: accepted selection, typed parameters, preview/commit), tool registry, push/pull ported to it, protocol spec in `docs/protocol.md` | **Checkpoint 2:** user reviews what writing a tool looks like | Done, awaiting user |
| S7 | 1 Core | Selection model: face/edge/vertex picking end to end, selection kept across operations | Edge and vertex picking work; selection survives push/pull | Done |
| S8 | 3 Tools | Fillet/chamfer tool on the tool API, with edge drag (outward fillet, inward chamfer) | Fillet and chamfer preview and commit from the UI | Done |
| S9 | 2 Interaction | Contextual toolbar generated from tool declarations, plus command search (Ctrl+K) | Selecting a face or edge shows only its valid tools | Done |
| S10 | 2 Interaction | Onscreen dimension label during drags, Tab for exact entry, for every tool with a distance/angle parameter | **Checkpoint 3:** screenshots of the toolbar and dimension UX to the user | Done, awaiting user |
| S10b | 2 Interaction | Measurement context on the drag label (start/delta, resulting size) and measure mode: right-click during a drag picks a measurement (e.g. edge parallel to the normal) whose edited value sets where the face ends up | User tries it on the bracket; decide which side moves and what stays fixed | Done, awaiting user |
| S11 | MVP | Parity check against the prototype feature list, fixes, run instructions in README | **Checkpoint 4:** user reviews; merge `rebuild` into `main` | Done, awaiting user |
| S12 | 4 Measure | Measurement readout on selections: click an edge, face or vertex and see its length, radius, diameter, area, etc. (plan below) | Selecting each kind on the demos shows correct values, checked against known dimensions | Done, awaiting user |
| S13 | 4 Measure | Drawing-style dimension leaders in the view for each selection's most useful value (plan below) | Selecting an edge, hole, flat face, fillet and vertex shows the right leader on the model; the panel still has everything else | Planned |

| S14 | Overnight | Nav cube, standard view keys, perspective/ortho toggle, look-at-face (V) | Verified in Chrome | Done, awaiting user |
| S15 | Overnight | Tool list + typed-value form (`layout.ts`), feature tools: delete face, remove/resize fillet, fill/resize/move/pattern/align/distribute holes, add hole/counterbore/countersink, box/cylinder/sphere/cone, shell, mirror, draft, align face, move/rotate/scale body | 61+ tests; form verified in Chrome | Done, awaiting user |
| S16 | Overnight | Sketch in 3D (SolveSpace solver): line/rectangle/circle/arc, constraints, dimensions, extrude join/cut | Verified in Chrome end to end | Done, awaiting user |
| S17 | Alpha | Portable alpha build for Windows, macOS and Linux (plan below) | **Checkpoint 5:** CI smoke tests pass on all three OSs and the release is published only then; user does a final check on Windows | Planned, before more features |
| S18 | Alpha | Multi-solid and import robustness: tools act on the containing solid, inverted/open solids flagged, OpenCASCADE errors translated ([alpha-readiness.md](alpha-readiness.md)) | Push/pull success rate on the AD5M and Gauge STEP files measured before and after; every failure readable; tests added | Done. push_pull success on 24 tries: Gauge 20 to 24, Frame 0 to 22, Enclosure 11 to 22 after closed surface bodies are made into solids on import (8 of 10 on Frame, 15 of 21 on Enclosure); the rest are truly open, named in the import warning. Tests 97 pass |
| S19 | Alpha | Autosave (BREP snapshots, capped, clean-exit marker) and restore prompt; cap the in-memory undo list | Kill the core mid-session, restart, restore returns model and undo steps | Planned, before S17 |
| S20 | Alpha | Busy/progress indicator for long operations | A 30 s open shows the indicator and the UI stays responsive | Planned, before S17 |
| S21 | Alpha | Alpha warnings, Copy diagnostics, issue template, license notices, known-limitations docs | Text reviewed by the user | Planned, before S17 |

**S17 plan (portable alpha, decided 2026-10-17):** `v0.2.0-mvp` (tag at `12cfff5`) preserves the MVP parity state as a source-only release. The alpha release adds the overnight and day-two progress in a form testers can run without installing uv or Node.

- Package: freeze the Python core with PyInstaller and ship the built frontend (`npm run build`) inside it. One launcher starts the core, serves the frontend, picks a free port, opens the browser, and exits when the tab closes. Tauri stays post-alpha.
- Build: GitHub Actions matrix (windows, macos arm64 and x64, ubuntu) on a version tag, uploading one archive per OS to the release.
- Known risks (log in `docs/watchlist.md`): OCP makes bundles large (hundreds of MB); macOS builds are unsigned (Gatekeeper warning, per-architecture builds); Linux depends on the build machine's glibc; the core currently binds fixed port 8765 and the client hardcodes it.
- Smoke tests (decided 2026-10-17: CI stands in for per-OS human testing, so users never get a broken release): after building, each OS job unpacks its own archive and runs the packaged launcher headless (no browser; a `--smoke` mode or a test client over the WebSocket). The test opens the bracket demo, checks the face count, runs a push/pull preview and commit, checks undo, exports STEP and re-imports it, and fails on any error or if the app does not start within a timeout.
- Gating: the tag build creates a draft release, every OS uploads its archive only after its smoke test passes, and a final job publishes the draft only if all jobs passed. A failed job leaves the draft unpublished.
- Limits (log in `docs/watchlist.md`): smoke tests do not cover the GUI (rendering, mouse, the browser opening) or macOS Gatekeeper behaviour on a real machine. Optionally add a headless-browser load check of the served page in the same job.
- Done when: all three smoke jobs are green on a test tag, the draft publishes, and the Windows archive passes the user's final manual check. The release notes say how to bypass the unsigned-app warnings.

After the MVP, the next tools come from research/direct-modeling-tools.md (delete face with heal, fillet removal, move/rotate face, relationship detection), each planned as its own session.

## Current status

**Research session done (2026-10-16):** research/tool-priorities.md holds the post-MVP tool order, how to offer relationship rules (detection chips, default off) and ideas from other direct modelers (Up To / Direction guides, Fill, tool completion types), and a draft modifier-bundle table. User answers folded in (sections 9-15): sketch before niche tools, add-ons far future, follow common industry defaults, no history but smart re-edit and last-op re-edit, draggers/guides framework before more tools, in-view measurement labels. Round 3 (sections 16-19): full sketch with solver moves down, primitives + holes as stopgap, usage check, alignment tools placement, revised order in section 19. Round 4 (sections 20-22): broader align/distribute tool, Stretch tool via cut-plane insert (spike early), updated order. Section 23: stretch as "extend" (surface-preserving rebuild) vs "insert" (cut-plane), spike definition pending user answers. **MVP done and merged into `main` (2026-10-17). S12 (measurement panel) done, awaiting user;** **S13 (dimension leaders on the model) done, awaiting user.**

S9 as built: `app/src/tools.ts` (registry types, `acceptsSelection`), `app/src/palette.ts` (Ctrl+K fuzzy search; unusable commands listed greyed with a hint), toolbar in `main.ts` showing only tools usable with the current selection (counts checked locally, refined by the core's `available_tools`); clicking a toolbar/palette tool arms it (drag then runs it); the drag tool is the armed one if it applies, else the first drag-capable tool for the selection. Toolbar buttons do not run anything by themselves yet (S10 adds typed values).

3D-printing top-20 (user-supplied, not gospel): resize length/width/height; change fastener hole diameter/depth; relocate holes; countersinks/counterbores; wall thickness/shell; cable slots; captive nut traps; fillets/chamfers; clearance tolerances; magnet pockets; ribs/gussets; thread pitch/tolerance; snap-fit latches; mounting flanges; ventilation slots/grids; interlocking joints (dovetails); sensor/switch/port cutouts; text labels; hollowing; mounting tabs/ears. Initial reading: ~14 of 20 fall into hole editing (resize/move a cylindrical face, delete face with heal), hole features (counterbore, countersink, nut trap, pocket), stretch/offset a face, shell/hollow, and add-from-profile (sketch + extrude, patterns); fillet/chamfer done; threads out of scope.

S1 findings (target of 300 ms **not yet met**; perforated_plate mesh still ~1.5 s median):
- Pulling the plate's top face creates ~410 new hole-wall faces; `BRepMesh_IncrementalMesh` takes ~870 ms (parallel; 1.7 s serial) to mesh them and is **insensitive to linear/angular deflection** (0.5 to 2, 0.5 to 1.0 rad), so it's per-face overhead, not triangle count. The other ~600 ms is the Python per-node/triangle loops in `tessellate.py` (`Node(i)`/`Normal(i)`/`Triangle(i)` calls; OCP exposes no bulk arrays).
- Untouched faces already keep their triangulation through push/pull (verified: 402 of 812 kept), so a per-face cache of converted arrays keyed on TShape never hits (the op's topology copy makes new TShapes). Dropped.
- Done: `tessellate.py` builds per-face numpy arrays; deflection quantized to a power of two so reused faces aren't re-meshed when the bbox drifts.
- Next to try: (1) ocp-tessellate (check speed and per-face identity); (2) cache converted arrays keyed on the triangulation itself rather than the face; (3) mesh new faces in a lower-quality preview mode, or reduce new-face count (fewer split faces from the extrusion); (4) decide if 300 ms on this stress model is a realistic gate: bracket total is 43 ms, and op alone is 1 s on the plate.

## S12 plan: measurement data on selections

Goal: after any click, show the numbers needed to edit features around the selection. Implements the contents list of research section 13, minus the drag-time and re-radius parts.

**Core (`core/src/pliable/measure.py`, new):** `measure(topology, selection) -> dict`, using `BRepAdaptor_Curve` / `BRepAdaptor_Surface` for the type and `GProp` (`BRepGProp.LinearProperties_s` / `SurfaceProperties_s`) for length and area. Per item:
- Edge: curve type (line, circle, arc, ellipse, other), length; circle/arc add radius, diameter, arc angle, center; a full circle is flagged (so a hole rim shows diameter). Line adds direction.
- Face: surface type (plane, cylinder, cone, sphere, torus, other), area, perimeter; plane adds normal and bounding width and height in the face plane; cylinder adds radius, diameter, axis, and length along the axis (a hole shows diameter and depth); sphere and torus add radii; a cylinder or torus-like face tangent to its neighbors is labelled "fillet" with its radius.
- Vertex: x, y, z.
- Several items of one kind: count and sums (total length, total area). Exactly two items: distance between them (min distance via `BRepExtrema_DistShapeShape`) and angle where it is defined (line-line, plane-plane).
All values in model units, rounded only in the UI.

**Protocol:** new request `measure` taking the same selection payload as `available_tools`; reply `measurements` holding a list of items (kind, id, a `rows` list of label/value/unit, and an anchor point) plus an optional summary. A query on selection, not data sent with every mesh, so it costs nothing for unselected geometry or the stress model. Document it in `docs/protocol.md`.

**Frontend:** after selection changes (same race guard as `available_tools`: ignore a stale reply), request `measure` and show a small panel with the rows. First cut is a panel, not in-view labels; a billboard label at the anchor point (research section 13) is the stretch goal if the session has room. Click a value to copy it. The drag-time dimension label from S10 stays as is, and the panel hides during drags.

**Tests:** known values on the bracket and block demos: block edge length and face area, bracket hole diameter and depth from its cylinder face, a 2-edge sum, parallel-face distance; fillet radius after running the fillet tool. Then verify in Chrome and screenshot for the user.

**Steps (each committed):** (1) `measure.py` for edges and faces with tests; (2) vertices, multi-select sums and two-item distance with tests; (3) protocol and server; (4) frontend panel; (5) in-view labels only if cheap; (6) docs, progress update, push.

**Done when:** selecting an edge, a hole wall, a flat face, a fillet face and a vertex on the demos shows the right values in the UI. Checkpoint session: stop and report with screenshots.

**Open questions (defaults chosen if unanswered):** units are plain model units with no setting yet; diameter shown beside radius for circles; the panel sits at the bottom left of the viewport.

## S13 plan: dimension leaders on the model

User request (2026-10-17): keep the S12 panel, and in addition show the most common value on the model itself with technical-drawing leaders, so the eyes stay on the part. If it is not the wanted value, the panel has the rest. This is the in-view label from research section 13, in drawing style.

**What is "the most common value" per selection** (the core decides, so the rule lives in one place):
- Line edge: length, as a linear dimension (two extension lines, a dimension line with arrows parallel to the edge, offset to the side away from the model; text centered on it).
- Full circle edge or hole wall: diameter with the diameter symbol, leader line through the center to the rim. Hole wall also shows its depth as a second, linear dimension along the axis.
- Arc edge or fillet face: radius with `R`, leader from the arc's center to the arc.
- Flat face: width and height as two linear dimensions along the face's own axes.
- Several edges: the total as a text tag at the centroid; two items: the distance as a linear dimension between their closest points (the same points `BRepExtrema` already finds).
- Vertex: coordinates as a small tag.

**Core:** add `dimension` to each `Measured` (and to the pair summary): `{kind: "linear" | "diameter" | "radius" | "tag", text, points: [[x,y,z], ...], offsetDirection?}`, built next to the rows in `measure.py`. `offsetDirection` for linear dimensions is the in-face direction away from the face's interior (a model-space vector), so the frontend can place it outside the part.

**Frontend:** an SVG overlay above the canvas, redrawn every frame (camera moves) by projecting the 3D points. Constant pixel size for text, arrowheads and the offset distance (named constants `DIM_OFFSET_PX`, `ARROW_PX` in one place, per the settings note). Draw nothing during a drag (the drag label owns the view), and never under the cursor: nudge the text away if it sits within a few pixels of the pointer. Clicking a panel row makes that row the one shown on the model (optional if cheap; otherwise a follow-up).

**Steps (each committed):** (1) core `dimension` data and tests; (2) SVG overlay with linear dimensions; (3) diameter, radius and tags; (4) hide during drags, avoid the cursor, panel-row promotion if cheap; (5) verify in Chrome on the bracket (edge, hole, flat face, fillet, vertex) with screenshots; docs and progress.

**Done when:** each selection kind above shows the right leader on the model and the S12 panel is unchanged. Checkpoint session: stop and report with screenshots.

**Open questions (defaults chosen if unanswered):** show on selection only, not on hover; leaders drawn in the selection orange; when text would overlap another label, keep the first and let the panel carry the rest.

## Input design (user preferences, 2026-10-16)

- **Navigation (implemented):** Simple left-select style. Left button selects and drags tools, wheel zooms toward the cursor, right-drag orbits, middle-drag pans. Fixed for now; no customization until after the MVP.
- **Modifier bundles (planned, minimal for the MVP):** the most-used action for each kind of selection (face, edge, vertex) is the plain default drag (face: push/pull; edge: fillet/chamfer, S8). Other tools are reached by holding Shift, Alt, Ctrl or combinations, grouped logically into bundles per selection type (e.g. one modifier for "move/rotate" style tools, another for "round/chamfer" style). Since there are few modifiers, each selection type has at most about 7 bundles. For the MVP, build only what S8-S10 need: the toolbar (S9) shows the plain default plus whatever tools exist, and each tool declaration may later carry a `bundle` modifier combo. Do not build a modifier remapping UI yet; keep the mapping in one place (a single table in the frontend) so it can be made configurable later.
- The author's daily CAD use pans with middle-drag, so navigation follows that habit and the left-select scheme above.
- **One drag, one value (post-MVP note):** a mouse drag sets a single value, so tools with several values (e.g. two-distance chamfer) will use on-screen draggers (one handle per parameter). A tool can already declare several `params`; the missing piece is a per-parameter handle anchor (point and direction on the model). Until then, extra values are entered by typing (S10). Where one value can carry two behaviors, use its sign: fillet/chamfer by drag direction in S8.
- **Typed values during a drag (spec for S10):** while a tool drag is active, typing digits starts value entry immediately (no Tab needed; Tab only switches fields in multi-value tools). The typed value overrides the dragged value and the live preview shows it; the on-screen dimension label becomes the editable field. Enter commits, Escape cancels the operation. After a commit the mouse state resets, so the next drag starts fresh from the new geometry; mouse movement during entry is ignored. MVP: plain numbers with a minus sign; units and expressions come later. The drag pipeline in `main.ts` already separates "distance from the mouse" from "distance sent to the core", so the override slots in at that point.
- **User settings (post-MVP):** pixel-based behavior (pick radii `VERTEX_PICK_PX`=9 and `EDGE_PICK_PX`=6, the 4 px click-versus-drag threshold, highlight line width and point size in `viewport.ts`) feels different on high-DPI and large monitors, so they must become adjustable settings later. For the MVP they stay as named constants in one place; keep any new pixel-based values as named constants too, so a settings system can replace them without hunting.
- **Multi-select (added after S8):** Ctrl+click (or Cmd+click) toggles an item in the selection; all items must be the same kind (adding a different kind starts a new selection); plain click replaces; Ctrl+click on empty space keeps the selection. Dragging any selected item runs its tool on the whole selection (e.g. fillet two edges at once). Tools that accept one face get an error if several faces are selected. Selection modifiers may need to be reconciled with the planned tool modifier bundles.
- **Dev-server gotcha:** Vite sometimes served a stale module after files were rewritten by a script; if the browser behaves like old code, restart `npm run dev` (check with `curl http://localhost:5173/src/<file>.ts`).
- **Failed previews:** while dragging, a failed preview keeps showing the last size that worked (smooth) and turns the status red ("limit reached"); releasing commits that last good size (falling back to it if the final request fails). If the very first preview already fails, the model stays unchanged with the error. Remaining preview-vs-commit gap: push/pull previews use the glued boolean, which can differ from the exact boolean at commit when the extrusion hits other geometry. Idea if it matters: verify the last preview with the exact boolean while idle, or flag previews that touch other faces.
- **Immediate drag:** pressing on a face or edge selects it and starts its tool drag in one motion; a press without movement is a plain click (replaces the selection).
- **Edge pick ties:** edges within `EDGE_TIE_PX` (2 px) of each other on screen are told apart by depth (nearer to the camera wins), so a through-hole's front rim wins over its back rim seen through the hole. Reported symptom that led to it: selecting the large wall hole highlighted only part of the circle (probably the back rim, mostly hidden by the wall). Not confirmed by the user yet. Earlier reports of 1/8 highlights with a real mouse could not be reproduced and may have been a stale Vite module.

## How to run

```
cd core
uv sync
uv run pytest
uv run python scripts/bench.py
uv run pliable-server        # ws://127.0.0.1:8765

cd app
npm install
npm run dev                  # http://localhost:5173, needs the server running
```

## Decisions and findings

- **Old prototype removed on this branch.** It's preserved at tag `v0.1.0-poc`. Only the push/pull approach (prism + boolean + UnifySameDomain) was carried over.
- **OCP 8 API differences:** collections moved to `OCP.collections` (e.g. `IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher`, `List_TopoDS_Shape`); `TopoDS.Face(...)` has no `_s` suffix; `Bnd_Box.Get()` doesn't convert, use `CornerMin()/CornerMax()`; `BRepTools_History` uses `IsRemoved` instead of `IsDeleted`; booleans have no `HasWarnings()`.
- **Booleans must be non-destructive** (`SetNonDestructive(True)`) because previews run repeatedly against the document's shape.
- **`ShapeUpgrade_UnifySameDomain` modifies its input in place,** even in safe-input mode, and the boolean result shares sub-shapes with the document. This silently corrupted the open model. Fix: unify a topology-only `BRepBuilderAPI_Copy` of the result. Covered by `test_push_pull_leaves_source_shape_untouched`.
- **Previews use the glued boolean** (`BOPAlgo_GlueShift`, parallel), which is 5-8x faster on large models but can be wrong if the extrusion intersects other geometry; commits always use the exact boolean.
- **Known cosmetic issue:** pulling a face that has holes leaves split faces in the hole walls (prism walls are extrusion surfaces, which UnifySameDomain can't merge with the original cylinders). Pushing (cutting) is clean.
- **Alternatives measured:** `BRepFeat_MakePrism` (faster than the exact boolean, but no face history) and per-face `BRepOffset_MakeOffset` (clean topology with neighbors adapting, but ~2.5 s on the stress model). Offset-face is a candidate for the later "stretch" tool.
- **Research** (2026-10-16): related projects in research/landscape.md; tools to build after the MVP and documentation terms in research/direct-modeling-tools.md. The closest competitor is Ductile (Rust, MIT, very young); Chili3D is AGPL-3.0, so its code can be reused.

## Benchmarks (headless, push/pull of the top face)

| Model | Faces | Triangles | Preview total (median) | Commit op (median) |
|---|---|---|---|---|
| block | 6 | 12 | 12 ms | 8 ms |
| bracket | 19 | 680 | 43 ms | 24 ms |
| perforated_plate (stress) | 410 | 43,324 | 2,600 ms (op 1,000 + mesh 1,600) | 2,360 ms |

## Checkpoint 1 report (S5)

End-to-end preview latency over the real WebSocket (`scripts/latency.py`: send request to full mesh received, one request at a time, push/pull of the top face):

| Model | Faces / triangles | Preview median | p95 | Commit | Undo |
|---|---|---|---|---|---|
| block | 6 / 12 | 12 ms | 13 ms | 11 ms | 3 ms |
| bracket | 19 / 680 | 44 ms | 46 ms | 45 ms | 15 ms |
| perforated_plate (stress) | 410 / 43k | 2.5 s | 2.8 s | 3.0 s | 0.6 s |

Browser rendering adds little on top (Three.js geometry upload; not measured separately). Open and undo are fast except on the stress model.

What works in the UI (verified in Chrome unless noted): demo picker, orbit/pan/zoom, face hover and selection, push/pull drag with live preview (latest request wins), commit on release, undo/redo (buttons, Ctrl+Z/Y), latency readout, STEP export and import buttons. STEP import/export is verified at the server level (bracket round trip: 19 faces, 51 edges preserved); the browser file dialog and download were not exercised by the automation. Escape-cancel mid-drag is implemented but not exercised.

Recommendation: **go.** Interactive models in the realistic range (tens of faces, hundreds to few thousand triangles) preview in 12-45 ms, which is smooth dragging. The stress model is not interactive (2.5 s), and the cost is split roughly 1 s boolean + 0.9 s OCCT meshing of new faces + 0.6 s Python mesh conversion. If large models matter for the MVP, the options are: coarser or lazy preview of changed faces only, sending only changed faces to the frontend, and moving mesh conversion out of Python loops (e.g. ocp-tessellate). Known issues: pulled faces with holes leave split hole-wall faces; previews use the glued boolean, which can be wrong if the extrusion hits other geometry.

## Log

- **2026-10-17 overnight (S14-S16):** autonomous session while the user slept, deciding by: user's described workflow > industry standard > common practice in other direct modelers > web consensus; open items in [questions.md](questions.md). Added nav cube (`navcube.ts`), view keys 0-6/P/V, ortho toggle (small-FOV camera trick); `features.py` tools registered automatically and listed by `app/src/layout.ts`; generic typed-value tool form (`toolpanel.ts`); sketch core `sketch.py` (py-slvs solver, profiles with holes, extrude) with protocol requests `sketch_plane`/`sketch_solve`/`sketch_extrude`; sketch UI `sketch.ts` + `sketchmodel.ts` (constraint table `CONSTRAINT_OPTIONS`). `Measure` now reports outward face normals. Gotchas: py-slvs circles need `addParamV`+`addDistance`+`addCircle` (the `V` circle variant ignores diameter constraints); fixing all three points of an arc is flagged redundant; heredocs with quotes broke the Bash tool, so write files with the Write tool. Stretch spike deliberately not started. Later the same night: relationship chips (`relations.py`, `Tool.related`), multi-face push/pull, hole/boss tools batched, resize fillet/chamfer, center between faces, circular/linear patterns, slot, cut with plane, offset body, round face edges, move/rotate/scale body, model info, combine STEP, edit last, double-click edge chain, sketch revolve/symmetric/construction. Gotcha: reusing a `LineSegments2` geometry whose segment count grows drew only the first segments; build a new geometry each time.
- **2026-10-17 (S13):** `measure` replies now carry `dimensions` (per item, or for the group: pair distance, or total tag) built in `measure.py`; frontend `app/src/dimensions.ts` is an SVG overlay redrawn every frame (linear with extension lines, diameter, radius, tag; constants `DIM_OFFSET_PX`, `ARROW_PX` etc. at the top; hidden during drags; text nudged away from the cursor). 43 tests; verified in Chrome: hole wall (diameter + depth), flat face (width, height), fillet (R6). Not checked by eye: edge, vertex, multi-select tags. Not done: panel-row promotion, overlap avoidance between labels. Fillet leader looks short when its axis points at the camera.
- **2026-10-17 (S12):** `core/src/pliable/measure.py` (edges, faces, vertices, multi-select totals, two-item distance and angle), `measure` request (documented in `docs/protocol.md`), bottom-left measurement panel in the frontend (`app/src/measure.ts`; click a row to copy; hidden during drags). 37 tests; verified in Chrome (hole rim edge, flat face). Not done: in-view labels anchored on the geometry (replies already carry an `anchor` point for them). Notes: `BRep_Tool.Continuity` is C0 on every edge after booleans, so fillet faces are detected by normals at the shared edge's midpoint; lengths show without units until a units setting exists; `uv run` fails while the server runs (exe locked), use `uv run --no-sync`.
- **2026-10-16 (S11):** Parity check vs `v0.1.0-poc`: STEP import/export, face/edge/vertex selection, push/pull with live preview and typed entry, fillet/chamfer by drag, undo/redo, status messages all present in the rebuild; nothing missing. README run instructions added; 26 tests pass. Awaiting Checkpoint 4. User confirmed browser STEP import and export work (2026-10-17).
- **2026-10-16 (S9):** Contextual toolbar and Ctrl+K palette; verified in Chrome (face shows Push/Pull, edge shows Fillet/Chamfer, palette filter and Esc).
- **2026-10-16 (S8):** Fillet/chamfer tool and edge drag (outward fillet, inward chamfer), edge outward normals in the mesh, error message fix; 26 tests; verified both in Chrome on the bracket.
- **2026-10-16 (S7):** Vertices in topology, mesh header and protocol; edge/vertex picking and highlight (thick lines via LineSegments2, point marker); selection mapping for edges/vertices through push/pull; 21 tests pass; verified edge, vertex and face picking and face-selection survival in Chrome.
- **2026-10-16 (S6):** Tool API (`tools.py`: `Tool`, `Accepts`, `Param`, `Selection`, registry), push/pull ported, protocol messages `list_tools`/`available_tools`/`tool_preview`/`tool_commit` replace the push/pull-specific ones, `docs/protocol.md` written, frontend picks its drag tool from the registry. 19 tests pass; verified in Chrome.
- **2026-10-16 (S5):** STEP open/export buttons, `scripts/latency.py`, Checkpoint 1 report.
- **2026-10-16 (S4):** Push/pull drag in the UI with live preview, commit, cancel, undo/redo and latency readout. Verified in Chrome: pulled the bracket's top face (commit 50 ms), undo restored it.
- **2026-10-16 (S3):** Face picking: raycast to triangle, binary search over face ranges, hover (yellow) and selected (orange) highlight meshes sharing the position buffer. Verified in Chrome on the bracket.
- **2026-10-16 (S2):** Vite + TS + Three.js scaffold, WebSocket client with binary mesh decoding, viewport with orbit/pan/zoom and edge lines, demo picker. Bracket verified in Chrome.
- **2026-10-16 (S1, partial):** profiled tessellation, see S1 findings; target not met.
- **2026-10-16 (S0):** Created `rebuild` branch, removed prototype, built Python core and tests, found and fixed the shape-corruption bugs above, added benchmark, saved research notes, wrote the session plan.
