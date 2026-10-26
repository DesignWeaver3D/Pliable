# Split checks

Baselines taken at tag `pre-split` (2026-10-22): 440 core tests (`docs/archive/split-baseline-core-tests.txt` also lists `test_tool_registry.py`, added in Phase 0, so it has 441 lines), 159 node tests in 26 files (`split-baseline-node-tests.txt`), `tsc --noEmit` and `npm run build` clean, frozen build 310 s, `core/scripts/smoke.py` passes on the frozen app.

## Gate commands (from `core/` and `app/`)

- `uv run pytest -q` and check the ids: `uv run pytest --collect-only -q | Select-String '::'` against `docs/archive/split-baseline-core-tests.txt` (new ids may be added, none may vanish).
- `uv run python ../scripts/check_moves.py check` (core moves only). It ignores `_faces_of` by name, because the plan drops the dead first copy; check the live one by hand.
- `npm test`, `npx tsc --noEmit`, `npm run build`.
- Phases 2 and 3 end with `uv run python scripts/build_app.py <label>` then `uv run python scripts/smoke.py dist/pliable/pliable.exe`.

## Chrome pass (app slices; one targeted check per slice)

1. Open a model; the body list and 3D view show it.
2. Sketch: draw a rectangle on a plane, add a dimension, finish.
3. Push/pull a face by dragging; undo.
4. Drag a hole handle; undo.
5. Save a project and load it again.
6. Import a STEP file.
7. After Phase 2: open an old `.plbl` and an old autosave.
