# Architecture plan (S112): split the large files safely

Status: DRAFT for owner approval. No code has been moved. Every split is a pure move: no behavior change, `dev` green after each step, one commit per move.

## Goal

- One small file per modeling tool (core) and per sketch shape or constraint (app), named after it, so a bug or improvement is found by file name.
- Shared helpers live outside the tool files, in one place, so no tool repeats them.
- Sketching is its own area on both sides (`sketch/` in `core` and in `app`), like a separate workbench. Solid tools and sketch code do not share files.
- Two agents can work in parallel (solid tools, and sketch/UI) without touching the same file.

## Target layout

Core (`core/src/pliable/`):

```
tools/        base.py (Tool, Param, Accepts, register: today's tools.py)
              one file per tool: push_pull.py, add_box.py, cut_plane.py, ...
              __init__.py imports every tool by name, in today's order
shared/       helpers used by two or more tools (combine, finish, new_body,
              plane frames, array copies, rounding rebuild, faces_of ...)
sketch/       solver.py, profiles.py, planes.py, operations.py, handlers.py
              __init__.py re-exports today's public names (STANDARD_PLANES, SketchError, regions, ...)
handlers/     server request handlers by area (datum, tools, files, ...)
server.py     Session and a thin router only
(document, files, measure, ... grouped into folders in the last phase)
```

App (`app/src/`): `main.ts` (about 100 lines, starts everything), `core/` (client, connection, restore), `viewport/` (camera, picking, look, boxselect, handles, measure), `sketch/` (mode, grid, snap, panel, render, model, `shapes/`, `constraints/`), `ui/` (panels, toolbar, body list, hints, search, settings), `dimensions/`, `keyboard/`.

Rules for new code afterwards: a new tool is a new file plus one import line; a helper used by two tools goes in `shared/`; a helper used by one tool stays in that tool's file; a file past about 400 lines is split.

## Findings from the checks (2026-10-22)

1. **Tests barely touch tool internals.** They go through `Session`, `get_tool`, `TOOLS` and the small modules. Only about 10 references reach into `features.py` (`_moved`, and `_all_round_walls` from `tools.py`). Test logic does not need rewriting; a few import lines change.
2. **Monkeypatching is limited and safe to keep:** `monkeypatch.setitem(TOOLS, ...)` (test_handles.py), `setattr` on `notice`, `tess.CACHE_LIMIT`, and `server._parked`. So `TOOLS`, `tessellate.CACHE_LIMIT` and `server._parked` must stay where they are (or be re-exported at the same import path). Tests also call `session._open` and `session._mesh_reply`, so those stay on `Session`.
3. **Saved data stores tool ids, not class names or module paths.** Recipes hold `{"tool": "add_box", ...}` and call `get_tool(...).make(...)`. No pickle. So tool `id` strings must never change. Class and file names are free.
4. **`features.py` defines `_faces_of` twice** (line 891, yields downcast `TopoDS.Face`; line 1177, yields raw shapes). Python uses the later one for every caller, including the three callers above line 1177 (Bridge at 992, and 1130, 1493). So today everything uses the raw version. The shared helper must be the raw version; the first definition is dead code and is dropped.
5. **Other modules import from `features`:** `holes.py`, `hole_tools.py`, `server.py`, `sketch.py`, `stretch.py`, `tools.py` (private names like `_combine`, `_plane_axes`, `_volume`, `_add_material`), and `unwrap.py` imports from `sketch`. These become imports from `shared/` and from the sketch package's re-exports. Many are inside functions to dodge import cycles, so the move order matters (see Phase 2).
6. **Packaging:** the release is frozen with PyInstaller (static imports only). Folder auto-discovery would silently drop tools from the packaged app, so `tools/__init__.py` uses an explicit import list, one line per tool.
7. **App tests** (26 files) import small modules directly (`../src/x.ts`). None covers `main.ts`, `viewport.ts` or `sketch.ts`, so those three are checked by typecheck, build and a Chrome pass, not tests.

## Risks and guards

| Risk | Guard |
|---|---|
| Registration order changes (toolbar, search, `TOOLS` order) | Explicit import list in today's order; registry snapshot test |
| `_faces_of` duplicate gives some callers a different version | Keep the raw version, as in finding 4 |
| Import cycles exposed by moves | `shared/` first, then tools; full suite after every move |
| Tool id changes break saved projects and autosaves | Ids never change; load an old `.plbl` and an old autosave after Phase 2 |
| Frozen build misses a module | `core/scripts/build_app.py` plus `core/scripts/smoke.py` at the end of Phases 2 and 3 |
| A "move" quietly changes code | Python identity check (below); no fixes inside move commits |
| TS module-level state and import order | Shared state object; keep import order; small slices |
| Class splits (`Viewport`, `SketchMode`) are not pure moves | Done last, one concern per commit, typecheck, build, Chrome check each |
| Owner's hot-reloading test page on 5180 | All work in a worktree on spare ports; merge only when the owner says |
| A forgotten tool import line | Test compares the registry to a golden id list |

## Phase 0: safety nets (committed before any move)

1. Registry snapshot test: tool ids in order, with label, accepts, params, body kind. Written against the current code, so it passes now.
2. Test-id check: save `pytest --collect-only -q` output now (417 tests); after every step the same ids must pass. Also save the node test list (150).
3. Python identity script (`scripts/check_moves.py`): for every top-level def and class in `core/src/pliable`, normalize with `ast`, hash it, and write the set. After a move the set must be equal apart from import lines and the deliberately dropped dead `_faces_of`. This is what proves a move was pure.
4. Duplicate-name audit across the package (finding 4 came from this idea); list every top-level name defined twice.
5. List which helpers each tool uses (a table: helper, users). This decides what goes to `shared/`.
6. Baselines: frozen build once, `tsc`, app build, `docs/` checklist for the Chrome pass (open model, sketch, push/pull, hole drag, save and load a project, STEP import).
7. Tag `dev` as `pre-split`.
8. Create the worktree (`scripts/worktree.ps1 new split`), spare ports, own `PLIABLE_DATA`.

## Phase 1: core, shared helpers (no tool moves yet)

Create `shared/`, move the helpers from the Phase 0 table into it, leave `features.py` importing them. Same commit updates the private imports in `holes.py`, `hole_tools.py`, `server.py`, `sketch.py`, `stretch.py`, `tools.py`. Gate after each commit (see Gate).

## Phase 2: core, tools into `tools/`

1. `git mv tools.py tools/base.py`; `tools/__init__.py` re-exports `TOOLS`, `register`, `get_tool`, `Tool`, `Param`, `Accepts`, `Handle`, `Selection` so every existing import still works.
2. Move tools out of `features.py` one family per commit, in order: holes (merge with `holes.py`/`hole_tools.py` only if tests stay identical; otherwise leave those two where they are), primitives, repair, transforms, arrays, profiles, rounding, plane cut, face edit. Each tool class becomes one file named after its id. Tools that already use one another stay in the same commit.
3. After each commit, add the new files' import lines to `tools/__init__.py` in the original registration order.
4. When `features.py` is empty, delete it. Gate plus: load an old `.plbl` and autosave; run `smoke.py`; run the frozen build.

## Phase 3: core, `server.py` handlers and `sketch/`

1. `server.py`: move handler groups into `handlers/` one group per commit (datum, mirror, primitive edit, dimension edit, tool run, files, sketch). `Session` and `_handle` stay in `server.py`. `_open`, `_mesh_reply`, `_parked` stay importable from `server`.
2. `sketch.py` becomes `sketch/` with `__init__.py` re-exporting every name `unwrap.py`, `server.py` and the tests import. Split solver, profiles, planes, operations in that order.
3. Gate plus the frozen build and `smoke.py`.

## Phase 4: app

Order, riskiest last: 1) `sketchmodel.ts` into `sketch/model.ts` and its helpers; 2) `main.ts` concerns one per commit (connection and restore, project file and export, body actions, toolbar and strip, selection, previews); 3) `sketch.ts` (grid, snap, shape builders into `sketch/shapes/`, panel, render); 4) `viewport.ts` (camera, look, boxselect, picking, handles, fit). Class splits keep the class as a thin coordinator; each extracted module takes what it needs as arguments. Before each slice, add a test for any logic that can be tested without a browser. After each slice: `tsc`, `npm test`, `npm run build`, and the Chrome checklist items that slice touches.

## Phase 5: folders and tests

1. Group the remaining flat files into folders as renames plus import fixes, one folder per commit.
2. Optionally split `test_features.py` (683 lines) and `test_handles.py` (526 lines) per tool family as pure moves, with the test-id check. Do this only after the code phases are done.
3. Update `docs/behavior.md` references (none expected), the large-files guidance in the project instructions file, and add the new-code rules above to `CONTRIBUTING.md`.

## Gate (after every commit)

- Registry snapshot test passes.
- Same test ids pass: 417 core, 150 node (counts rise only when a commit adds tests).
- `tsc --noEmit` and `npm run build` pass.
- For core moves: identity script reports the hash set unchanged.
- Code and tests never change in the same commit, except import-path edits in tests.
- Commit message says it is a pure move and lists what moved.

## Rollback

One commit per move: revert that commit. The `pre-split` tag restores everything. Nothing is pushed or merged into the owner's checkout until the owner says to.

## Order for the feedback rows S113-S127

After Phase 2 and Phase 3, core/model rows (S113-S120) and UI/sketch rows (S121-S127) live in disjoint files and can go to two agents in parallel. S113 (save-project fix) is independent and can run any time.

## Open decisions

- Whether to merge `holes.py`/`hole_tools.py` into `tools/` or leave them (decided in Phase 2 by test results).
- Whether to do Phase 5 test splitting at all.
