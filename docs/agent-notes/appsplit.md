# App split agent notes

Shared-state design: plain-field `app` object in `app/src/appstate.ts` (like `bodyView`); split modules are `createX(deps)` functions, deps use getters for parts main.ts builds later.

## Done
- Slice 1: selection state into `app`; `selection.ts` (setSelection, selectionPayload, describe, mappedSelection); `modelview.ts` (show, syncHistoryButtons, setCommitted).

## Remaining
- Slice 2 (drag and preview state machine), slice 3 (sketch.ts), slice 4 (viewport.ts).
