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
| S10 | 2 Interaction | Onscreen dimension label during drags, Tab for exact entry, for every tool with a distance/angle parameter | **Checkpoint 3:** screenshots of the toolbar and dimension UX to the user | Next |
| S11 | MVP | Parity check against the prototype feature list, fixes, run instructions in README | **Checkpoint 4:** user reviews; merge `rebuild` into `main` | |

After the MVP, the next tools come from research/direct-modeling-tools.md (delete face with heal, fillet removal, move/rotate face, relationship detection), each planned as its own session.

## Current status

**Research session done (2026-10-16):** research/tool-priorities.md holds the post-MVP tool order, how to offer relationship rules (detection chips, default off) and ideas from other direct modelers (Up To / Direction guides, Fill, tool completion types), and a draft modifier-bundle table. User answers folded in (sections 9-15): sketch before niche tools, add-ons far future, follow common industry defaults, no history but smart re-edit and last-op re-edit, draggers/guides framework before more tools, in-view measurement labels. Round 3 (sections 16-19): full sketch with solver moves down, primitives + holes as stopgap, usage check, alignment tools placement, revised order in section 19. Round 4 (sections 20-22): broader align/distribute tool, Stretch tool via cut-plane insert (spike early), updated order. Section 23: stretch as "extend" (surface-preserving rebuild) vs "insert" (cut-plane), spike definition pending user answers. **Next: S10** (dimension label during drags, typed values per the spec above; Checkpoint 3). S1-S9 done.

S9 as built: `app/src/tools.ts` (registry types, `acceptsSelection`), `app/src/palette.ts` (Ctrl+K fuzzy search; unusable commands listed greyed with a hint), toolbar in `main.ts` showing only tools usable with the current selection (counts checked locally, refined by the core's `available_tools`); clicking a toolbar/palette tool arms it (drag then runs it); the drag tool is the armed one if it applies, else the first drag-capable tool for the selection. Toolbar buttons do not run anything by themselves yet (S10 adds typed values).

3D-printing top-20 (user-supplied, not gospel): resize length/width/height; change fastener hole diameter/depth; relocate holes; countersinks/counterbores; wall thickness/shell; cable slots; captive nut traps; fillets/chamfers; clearance tolerances; magnet pockets; ribs/gussets; thread pitch/tolerance; snap-fit latches; mounting flanges; ventilation slots/grids; interlocking joints (dovetails); sensor/switch/port cutouts; text labels; hollowing; mounting tabs/ears. Initial reading: ~14 of 20 fall into hole editing (resize/move a cylindrical face, delete face with heal), hole features (counterbore, countersink, nut trap, pocket), stretch/offset a face, shell/hollow, and add-from-profile (sketch + extrude, patterns); fillet/chamfer done; threads out of scope.

S1 findings (target of 300 ms **not yet met**; perforated_plate mesh still ~1.5 s median):
- Pulling the plate's top face creates ~410 new hole-wall faces; `BRepMesh_IncrementalMesh` takes ~870 ms (parallel; 1.7 s serial) to mesh them and is **insensitive to linear/angular deflection** (0.5 to 2, 0.5 to 1.0 rad), so it's per-face overhead, not triangle count. The other ~600 ms is the Python per-node/triangle loops in `tessellate.py` (`Node(i)`/`Normal(i)`/`Triangle(i)` calls; OCP exposes no bulk arrays).
- Untouched faces already keep their triangulation through push/pull (verified: 402 of 812 kept), so a per-face cache of converted arrays keyed on TShape never hits (the op's topology copy makes new TShapes). Dropped.
- Done: `tessellate.py` builds per-face numpy arrays; deflection quantized to a power of two so reused faces aren't re-meshed when the bbox drifts.
- Next to try: (1) ocp-tessellate (check speed and per-face identity); (2) cache converted arrays keyed on the triangulation itself rather than the face; (3) mesh new faces in a lower-quality preview mode, or reduce new-face count (fewer split faces from the extrusion); (4) decide if 300 ms on this stress model is a realistic gate: bracket total is 43 ms, and op alone is 1 s on the plate.

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
