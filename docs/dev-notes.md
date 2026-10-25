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
- Pulling a face with holes leaves split faces in the hole walls (extrusion walls do not merge with the original cylinders); pushing is clean.
- Alternatives measured: `BRepFeat_MakePrism` (no face history), per-face `BRepOffset_MakeOffset` (clean but 2.5 s on the stress model; candidate for stretch).
- Performance: bracket preview 43 ms; the 410-face perforated plate stays about 1.5 s to mesh (per-face meshing overhead, not triangle count). Tessellation is per-face numpy arrays with power-of-two deflection. A commit on a many-body model costs about 300 ms at 150 bodies (finding each face's owning body 65 ms, OCCT meshing 60 ms, building ids and ranges about 100 ms) and sends the whole mesh to the browser.
- Body ids after an operation are matched by shape and volume (see the watchlist); the draft-angle dimension assumes a Z pull direction.
- Prototype preserved at tag `v0.1.0`. Closest open-source competitor is Ductile (Rust, MIT, young); Chili3D is AGPL-3.0 so its code may be reused (`docs/research/landscape.md`).

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
