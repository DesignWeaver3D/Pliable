# Rebuild Progress Log

Working log for the rebuild described in [ROADMAP.md](../ROADMAP.md). Read this first in every session (see the local session guide for the session rules).

## Session plan to the MVP

Each session is scoped to fit comfortably in one usage window using Sonnet with a fresh conversation. Each ends with tests passing, this file updated, and a push. **Checkpoint** sessions end with a report to the user, and work doesn't continue until the user responds.

The MVP target is parity with the `v0.1.0-poc` prototype: STEP import/export, face/edge/vertex selection, push/pull with live preview and exact entry, fillet/chamfer by dragging, undo/redo.

| # | Milestone | Goal | Done when | Status |
|---|---|---|---|---|
| S0 | 0 Spike | Python core, tests, headless benchmark | Core tests pass; benchmark recorded below | Done |
| S1 | 0 Spike | Fast tessellation | Stress-model (`perforated_plate`) mesh time under 300 ms in `scripts/bench.py`; tests pass | In progress |
| S2 | 0 Spike | Frontend scaffold: Vite + TypeScript + Three.js in `app/`, WebSocket client, open a demo, render faces and edges, orbit/pan/zoom | Bracket demo renders in the browser (verified by screenshot) | |
| S3 | 0 Spike | Face picking: hover and selection highlight using the face ranges from the mesh | Hovering and clicking faces highlights the right face | |
| S4 | 0 Spike | Push/pull drag: drag axis from the face normal, live preview with one request in flight (latest wins), commit on release, Escape cancels, undo/redo buttons, latency readout | Dragging the bracket's top face previews and commits; undo works | |
| S5 | 0 Spike | STEP open/export in the UI; measure end-to-end drag latency on all demos; write the checkpoint report | **Checkpoint 1:** report latency numbers and a go/no-go recommendation to the user | |
| S6 | 1 Core | Tool API (declarative tool classes: accepted selection, typed parameters, preview/commit), tool registry, push/pull ported to it, protocol spec in `docs/protocol.md` | **Checkpoint 2:** user reviews what writing a tool looks like | |
| S7 | 1 Core | Selection model: face/edge/vertex picking end to end, selection kept across operations | Edge and vertex picking work; selection survives push/pull | |
| S8 | 3 Tools | Fillet/chamfer tool on the tool API, with edge drag (outward fillet, inward chamfer) | Fillet and chamfer preview and commit from the UI | |
| S9 | 2 Interaction | Contextual toolbar generated from tool declarations, plus command search (Ctrl+K) | Selecting a face or edge shows only its valid tools | |
| S10 | 2 Interaction | Onscreen dimension label during drags, Tab for exact entry, for every tool with a distance/angle parameter | **Checkpoint 3:** screenshots of the toolbar and dimension UX to the user | |
| S11 | MVP | Parity check against the prototype feature list, fixes, run instructions in README | **Checkpoint 4:** user reviews; merge `rebuild` into `main` | |

After the MVP, the next tools come from research/direct-modeling-tools.md (delete face with heal, fillet removal, move/rotate face, relationship detection), each planned as its own session.

## Current status

**Next: finish S1 (fast tessellation), see findings below.**

S1 findings (target of 300 ms **not yet met**; perforated_plate mesh still ~1.5 s median):
- Pulling the plate's top face creates ~410 new hole-wall faces; `BRepMesh_IncrementalMesh` takes ~870 ms (parallel; 1.7 s serial) to mesh them and is **insensitive to linear/angular deflection** (0.5 to 2, 0.5 to 1.0 rad), so it's per-face overhead, not triangle count. The other ~600 ms is the Python per-node/triangle loops in `tessellate.py` (`Node(i)`/`Normal(i)`/`Triangle(i)` calls; OCP exposes no bulk arrays).
- Untouched faces already keep their triangulation through push/pull (verified: 402 of 812 kept), so a per-face cache of converted arrays keyed on TShape never hits (the op's topology copy makes new TShapes). Dropped.
- Done: `tessellate.py` builds per-face numpy arrays; deflection quantized to a power of two so reused faces aren't re-meshed when the bbox drifts.
- Next to try: (1) ocp-tessellate (check speed and per-face identity); (2) cache converted arrays keyed on the triangulation itself rather than the face; (3) mesh new faces in a lower-quality preview mode, or reduce new-face count (fewer split faces from the extrusion); (4) decide if 300 ms on this stress model is a realistic gate: bracket total is 43 ms, and op alone is 1 s on the plate.

## How to run

```
cd core
uv sync
uv run pytest
uv run python scripts/bench.py
uv run pliable-server        # ws://127.0.0.1:8765
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

## Log

- **2026-10-16 (S1, partial):** profiled tessellation, see S1 findings; target not met.
- **2026-10-16 (S0):** Created `rebuild` branch, removed prototype, built Python core and tests, found and fixed the shape-corruption bugs above, added benchmark, saved research notes, wrote the session plan.
