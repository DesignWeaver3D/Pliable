# Developer notes

Lasting technical notes moved out of `progress.md` so the plan stays short. Read the part you need; nothing here is a task list.

## Working with the owner's test setup

- The owner's frontend on port 5180 is served from the main checkout `C:\dev\pliable` with a core on 8770. Every file edit there hot-reloads their page mid-test, so while they are testing, do the work in a worktree (`scripts/worktree.ps1 new <name>`, add `-Base <branch>` to start from another branch) or in an agent's worktree, verify on spare ports (core 8805+, frontend 5205+, own `PLIABLE_DATA`), and merge into `dev` only when the owner says to ("merge so I can test").
- After a merge: delete the agents' `docs/agent-notes/*.md`, remove the merged worktrees, and restart the owner's core when core code changed (stop the 8770 listener and its `uv run`/`pliable-server` parents, start `uv run pliable-server --port 8770` hidden from `core/`); tell them to reload. Never stop their servers otherwise.
- Agents in worktrees: see `docs/orchestration.md` (worktrees from `scripts/worktree.ps1` run through Bash with `powershell.exe -File` because the PowerShell tool aborts the script on git's stderr; refresh before every hand-off).

## Pitfalls

1. Socket requests carry their own `id`, so request parameters must never be called `id` (kept sketches use `sketch_id`); `Session.handle` tests cannot see that.
2. Commit messages written from PowerShell get a BOM and are rejected; write them with a Bash heredoc, subject 12-72 chars, body lines of at most 80 characters for commits touching 3 or more files.
3. Long inline Python heredocs sometimes fail to parse in Bash; write the edit script to a file in the scratchpad and run it.
4. Chrome: dismiss the alpha notice and the "Got it" hint first; discard an open sketch before closing or navigating (the page warns on leave and the tab then hangs); expect `tabs_close_mcp` to time out sometimes.
5. npm and npx only work from the PowerShell tool; `uv` works from both.
6. Node tests strip types only: no TypeScript parameter properties, and imports in files the tests load need the `.ts` extension.
7. Vite sometimes serves a stale module after files are rewritten by a script; restart `npm run dev` if the browser acts like old code.
8. Spare-port checking recipe: core on 8805, frontend `VITE_CORE_PORT=8805 npx vite --port 5205`, `PLIABLE_DATA` in temp; stop your servers and close your tab afterwards.

## Kernel avoidance (owner, 2026-10-31)

- The kernel is the performance bottleneck, so anything slow for it should first be solved faster before the kernel is called: preprocess in the app or the core and pass the kernel only the minimum geometry a successful model needs. Pick or preview work that does not need the exact shape should not touch it.
- Whether other programs' strategies for large models and curved-surface geometry apply to Pliable is open. Only trustworthy sources count; otherwise form our own approaches and measure them (`scripts/bench.py`).

## Design stance (input)

- Navigation: left selects and drags tools, wheel zooms toward the cursor, right-drag orbits, middle-drag pans (also during a tool drag). Pressing on a face or edge selects it and starts its drag in one motion; a press without movement is a click.
- Ctrl/Cmd+click toggles multi-select of one kind; dragging a selected item runs its tool on the whole selection.
- One drag sets one value; tools with several values get one on-screen handle per parameter and typed entry. While a drag is active, typing digits starts value entry (Tab switches fields, Enter commits, Escape cancels). Sign carries a second behavior where sensible (fillet outward, chamfer inward).
- A failed preview keeps the last good size and turns the status red; release commits the last good size. Previews use the glued boolean and may differ from the exact boolean at commit.
- Pixel constants (pick ranges, click-versus-drag threshold) live in settings or one named place, never inline.
- Edge ties within 2 px are broken by depth.

## Kernel notes

- Python core with OpenCASCADE through OCP 8. API differences: collections live in `OCP.collections` (`IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher`, `List_TopoDS_Shape`); `TopoDS.Face(...)` has no `_s` suffix; use `Bnd_Box.CornerMin()/CornerMax()`; `BRepTools_History` has `IsRemoved`; booleans have no `HasWarnings()`.
- Booleans must be non-destructive (`SetNonDestructive(True)`) because previews run repeatedly on the document's shape.
- `ShapeUpgrade_UnifySameDomain` modifies its input in place and the boolean result shares sub-shapes with the document. Unify a `BRepBuilderAPI_Copy` of the result (test `test_push_pull_leaves_source_shape_untouched`).
- Previews use the glued boolean (`BOPAlgo_GlueShift`, 5-8x faster, wrong if the extrusion intersects other geometry); commits use the exact boolean.
- The kernel's face merge joins two faces of one cylinder only when their frames agree apart from a shift along the axis (same axis direction, same start of the angle, same turning sense). An extruded hole wall comes out as the mirror image of the wall it continues, so pulled hole walls stayed split; `wallframes.py` builds such a wall again on a surface with its neighbor's frame before the merge (`unify_result`), on commits only.
- Alternatives measured: `BRepFeat_MakePrism` (no face history), per-face `BRepOffset_MakeOffset` (clean but 2.5 s on the stress model; candidate for stretch).
- Performance, measured through the session (push/pull of the top face, one preview step): bracket 37 ms; the 410-face perforated plate about 1.1 s (operation 0.45 s, mesh 0.57 s), down from 3.3 s. What made the difference, in order of size: the kernel's validity check ran three times per preview and cost ten times the glued boolean (now once, in parallel, `validity.py`); the mesher's default algorithm needs about 0.4 s for a flat face with 400 holes (`meshing.py` gives such faces to the other algorithm); reading nodes and triangles one kernel call at a time cost 0.6 s (`meshread.py` reads the kernel's binary dump with numpy); and no face of an edited body was ever found in the display cache, because every operation copies the body (`tessellate.py` `_MeshKey` finds faces by their triangulation). `BRepAdaptor_Surface(face)` walks every edge of the face to find its outline: pass `False` as its second argument when only a point of the surface is evaluated, or a loop over the edges of a face with many holes turns quadratic. The profiler (`cProfile`) loses most of the time spent in kernel calls here; time stages with `time.perf_counter` instead. Tessellation is per-face numpy arrays with power-of-two deflection. A commit on a many-body model costs about 300 ms at 150 bodies (finding each face's owning body 65 ms, OCCT meshing 60 ms, building ids and ranges about 100 ms) and sends the whole mesh to the browser.
- Body ids after an operation are matched by shape and volume (see the watchlist); the draft-angle dimension assumes a Z pull direction.
- Prototype preserved at tag `v0.1.0`. Closest open-source competitor is Ductile (Rust, MIT, young); Chili3D is AGPL-3.0 so its code may be reused (`docs/research/landscape.md`).

## Push/pull modes and ghost

- Request params of `push_pull` (beside `distance`, `symmetric`, `ux uy uz`): `mode` is a string, `"auto"` (default), `"add"`, `"subtract"` or `"new"`; `flip` is a bool.
- Auto: the extrusion of a face is a tool volume; a drag along the face normal (distance > 0) fuses it with every body it meets, a drag against it cuts every body it meets and also removes nothing from empty space. `flip` reverses which direction adds and which subtracts; it never changes a face normal. Symmetric: the normal side adds, the opposite side subtracts.
- `add` always fuses, `subtract` always cuts, whatever the direction; `new` adds the extrusion as its own separate solid with no boolean (faces of a solid and loose sketch regions alike).
- A subtract that removes nothing changes nothing. A commit fails with "Nothing to subtract: the extrusion does not reach any body" (the model is unchanged). A preview does not fail: it returns the unchanged model with `notice` (that text) in the mesh header, so the drag keeps going and the ghost can still be drawn; show `notice` in the status line.
- Reply (preview only): when the extrusion subtracts, the mesh header carries `ghost`: `{"triangles": n, "bounds": [xmin, ymin, zmin, xmax, ymax, zmax]}` and the binary buffers `ghostPositions` (f32, n*3 per vertex), `ghostNormals` (f32) and `ghostIndices` (u32), the same layout as the body buffers. The ghost is the cutting volume minus all bodies (the part in empty space). The field and buffers are absent when nothing is outside the bodies or the operation does not subtract.
- Other subtracting tools: a tool that cuts with a tool volume records the volumes in `OpResult.cutters` (`finish(shape, cutters)` in `shared/solids.py` does it), and `Tool.execute` calls `attach_ghost` for every preview, so the reply carries the same `ghost`. Recorded: helical sweep and revolve face (Subtract), sweep face along edge (Subtract), the hole tools and slot (shared `_HoleOnFace.run`, `add_slot.py`; their cutters start on the face and a through hole or slot, depth 0, has none), and Emboss/Cut along surface through push/pull. Not recorded: Boolean subtract (the tool is itself a body), Cut with plane, fillets and other tools with no tool volume. Up to 3 cutters may overlap and are cut one after another; more are taken as disjoint pieces (coil turns) and cut in one go.

## Desktop shell (Tauri)

- Layout and build steps are in the Desktop shell section of `CONTRIBUTING.md`. The shell is `desktop/src-tauri/src/main.rs`; it sets `PLIABLE_DATA` (the core's saved files go to `data/core` beside the program) and `PLIABLE_SHELL` (the version, so the diagnostics report says it runs in the window). `PLIABLE_PORT` forces the core's port (the smoke test uses it) and `PLIABLE_CORE` points at a core program to run instead of `core/pliable` (development).
- Local Windows builds without the Visual Studio C++ build tools (installing them needs an admin prompt): install a user-level GNU toolchain (`winget install BrechtSanders.WinLibs.POSIX.UCRT`, `rustup toolchain install stable-x86_64-pc-windows-gnu`) and set `RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-gnu`. That build needs `WebView2Loader.dll` copied next to the program (the MSVC build links it in, so CI does not), and `cargo build` needs `--features custom-protocol`. Treat it as a compile check; the MSVC build from CI is the real one.
- The shell picks port 8765 when free, else a random one. The page's saved settings are per port, so a random port starts with default settings.
- Freezing the core takes about 3 minutes and the first shell build about 4 on a laptop; changes to the shell alone rebuild in a minute.

## Typed numbers and formulas

- Every typed number goes through `app/src/numberformat.ts` (the decimal character: point, or comma when "Comma as decimal" is on), `formula.ts` (+ - * / ^, unary signs, brackets; no eval) and, for text boxes, `numberfield.ts`. Never use `parseFloat`, `Number()` on user text or `type="number"`; `app/tests/numberentry.test.mjs` counts them per file against `numberentry.baseline.json` and fails on any new one. After removing one, refresh the record with `UPDATE_BASELINE=1`.
- Shown numbers come from `showNumber` in `precision.ts`, which uses the same decimal character; use `roundValue` when a number is needed. The core and saved files only ever see numbers with a point.

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

## Multi-body interaction (code survey, 2026-11-10)

Facts the "Body interaction setting" row in `progress.md` is built on; read before changing it.

- Hidden bodies are view state only (`bodyView.hidden` in `app/src/appstate.ts`): not saved in the project file, not part of undo, cleared on new or open (`modelview.ts`). Isolate is the same set. Ghost (see-through) and focus bodies are not hidden. The frontend sends the hidden ids only with `tool_preview` and `tool_commit` (`client.ts`), and `body_scope.py` reads them from `topology.hidden_bodies`. A result therefore depends on what was hidden when the tool ran; this is accepted (owner: visibility is a global rule).
- Tools that merge into or cut other bodies: push/pull Up to face, Up to last, Through all (`assemble_pads` in `pushpull_upto.py` fuses every pad with all solids) and push/pull of loose regions (`push_pull_sheets`: adders fuse with, cutters cut, every body); new hole, counterbore, countersink, boss, slot, thread, Revolve and helical sweep, Sweep, Loft (`skips_hidden_bodies`); primitives with `new_body` 0 (`_add_material`); Mirror and the four arrays (`_fuse_copies`, `mirror.py`: fuse the copies into the whole scene, hidden bodies included). Plain push/pull of a body face works per owning solid and never merges.
- Up to face, Up to last and Through all refuse Subtract and ignore Flip (`pull_up_to_face`, `pull_to_extent`); they always fuse along the face normal (`pull_direction` turns a gizmo direction to point out of the face, so a drag cannot choose the other side).
- Sketch regions: a region lying on a flat face of a body is imprinted on it and belongs to that body; any other region is a loose face (`sketch/profiles.py add_regions`). A scene with any loose face is never narrowed (`body_scope._has_loose_faces`), so scoping and the hidden-body skip do not work at all while a loose region exists.
- The setting (`interaction.py`): the app sends `interact` ("this" or "others") with tool_preview, tool_commit and the tool-handles query; the handler keeps it as `topology.interact` (like `hidden_bodies`; absent = the tool's default, `Tool.interaction`). `interaction.effective` decides the value (a loose region selected forces "others" with options ["others"]) and replies carry `"interact": {"value", "options"}`; `list_tools` carries `"interaction"` per tool. "this" makes `Tool.execute` narrow strictly (`body_scope.narrow(strict=True)`), "others" is the old skip-hidden-and-locked narrowing. A tool needs both `interaction` and `skips_hidden_bodies` to honor "others".
- Extent modes under "this": the pad is fused into or cut from only the owning bodies, but what it ends on comes from the whole scene minus hidden bodies. `narrow` stores that as `inner.reference_shape` (locked bodies included: references) and `pull_to_extent(reference=...)` measures "what lies ahead" and the farthest extent on it, then `assemble_pads` works on the narrowed shape. Up to face: `Narrowed.values` passes a target face outside the narrowed scene as `target_face` (the TopoDS face); a target inside a hidden body still refuses.
- Draft's "lowest point" pivot is now the lowest point of the drafted body (the tool description still says "model's").
