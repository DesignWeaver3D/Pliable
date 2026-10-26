# App split agent notes

Shared-state design: plain-field `app` object in `app/src/appstate.ts` (like `bodyView`); split modules are `createX(deps)` functions, deps use getters for parts main.ts builds later.

## Done
- Slice 1: selection state into `app`; `selection.ts` (setSelection, selectionPayload, describe, mappedSelection); `modelview.ts` (show, syncHistoryButtons, setCommitted).

- Slice 2: `itemdrag.ts` (pump, toolRequest, dimension label, typed entry, onItemDrag); main.ts calls createItemDrag, itemDrag.installKeys() and assigns viewport.onItemDrag in the original places (listener order kept).

- Slice 3 (part): `sketchasks.ts` (askForm, askNumber; the class methods delegate) and `sketchsolve.ts` (createSolver: resolve and the solve loop; SketchMode builds it in its constructor from a context of closures, `solver.isSolving()` replaces `this.solving`).

## Remaining and why stopped
- sketch.ts pointer handling (onMove, onDown, startDrag, place), projection (pickToProject..projectModel), editInline/selectDimension: each touches 10+ private fields (drag, selection, hover, undoStack, chain, cursor) and has no test; a real-mouse drag cannot be checked by browser automation here. Needs the existing Context-interface pattern (BuilderContext etc.) extended; resume by extracting projection (pickToProject, cancelProjectPick, finishProjectPick, projectModel, toggleProjectPick: they only use projectPick, viewport, host, renderPanel) first, then dimension dialogs (editInline, editDimension).
- viewport.ts: not started; same reason, needs owner hand-checks of orbit, picking and handle drags.
- Phase 5 (core folders) untouched.

## Shift-click check
Compared the pre-refactor commit (a08cfac) with this branch on the bracket sample: click then Shift-click another face leaves one face selected, Ctrl-click gives 2 faces, double-click selects the body. Identical on both builds, so Shift-click not adding a face is existing behaviour, not a regression.
