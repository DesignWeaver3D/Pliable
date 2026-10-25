# App split proposals: `main.ts` and `sketch.ts`

Status: proposal for the owner to approve. No code changes come with it. Context: [architecture-plan.md](architecture-plan.md) Phase 4; already moved: `sketchconstraints.ts`, `filesave.ts`, `restoreprompt.ts`, `sketchgrid.ts`, `sketchsettings.ts`.

## What blocks the next slices

Both files are glue over mutable state that many functions read and write.

**`main.ts` (about 1700 lines)** keeps this state at module level: `committed` (last committed mesh), `currentSels`, `refined`, `related`, `armedTool`, `lastOp`, `hiddenBodies`, `ghostBodies`, `focusState`, `measuredDims`, and the drag trio `dragSels`, `queued`, `lastGood` (plus `inFlight`, `session`, `previewFailed`, `dragSymmetric`, `dragValue`, `typed`). The concerns left (body actions, toolbar and strip, selection, previews) each touch several of these.

**`sketch.ts` (about 2130 lines)** is one class. The shape builders, snap and pick, the card panel and render all use `this.s` (the sketch data), `this.selection`, `this.chain`, `pushUndo()`, `resolve()`, `pointFor()`, `host`, `viewport`.

## Option A (recommended): a state object plus narrow "deps" per module

Rules, so nothing new is invented beyond what the code already does:

1. **No behavior change, one slice per commit.** Same gate as before: `tsc`, node tests, build, Chrome check of what the slice touches.
2. **`main.ts`:** group the module-level `let`s into one exported `AppState` object in `appstate.ts` (plain fields, no events, no framework). Extracted modules receive `state` and the few functions they call (`setCommitted`, `setSelection`, `show`) as arguments, like `installFileOpening` already does. `main.ts` stays the place where everything is created and wired.
   Slice order (lowest risk first):
   1. `bodyactions.ts`: `setVisibility`, `runBodyRequest`, the `BodyList` callbacks, `applyVisibility`, `ownerBody` (reads `committed`, `currentSels`, the hidden and ghost sets).
   2. `toolstrip.ts`: `renderToolbar`, `renderSketchStrip`, `renderChips`, `selectionHelpers`, the drawer toggle (reads selection, tools, armed tool).
   3. `selection.ts`: `setSelection`, `describe`, `mappedSelection`, `selectionPayload`, `pickProfile`.
   4. `previews.ts`: `pump`, `toolRequest`, `drainPreviews`, `runPreview`, `centrePreviews`, the dimension label and typed entry. Last, because it is the riskiest (the drag state machine).
3. **`sketch.ts`:** keep `SketchMode` as the owner of its state; extract by concern into plain functions that take a **`SketchContext`** interface (a type, not a class) listing only what they use:
   ```ts
   interface SketchContext {
     s: SketchData;                       // current sketch (read and mutated, as today)
     selection: SketchSel[];
     pushUndo(): void;
     resolve(drag?: Drag): Promise<boolean>;
     pointFor(snap: Snap): number;
     addConstraintRaw(c, kind?): void;
     status(text: string, error?: boolean | "warn"): void;
     options: SketchOptions;
   }
   ```
   `SketchMode` implements it (the methods already exist; most become public), and passes `this`. Slice order:
   1. `sketchbuilders.ts`: `addLine`, `addRectangle`, `addPolygon`, `addCircle`, `addEllipse`, `addSpline`, `addArc*`, `addSlot` (they only need the context; geometry is already in `sketchshapes.ts`).
   2. `sketchsnap.ts`: `snap`, `nearestPoint`, `pick` (need the viewport projection and the sketch data, no mutation).
   3. `sketchpanel.ts`: `renderPanel`, `transformButtons`, `askForm`, `askNumber` (DOM building; calls back into the mode).
   4. Render and draw helpers last (`render`, `drawAxes`, `liveDimensions`), since they hold the Three.js objects.

**Cost and risk:** more files and argument lists, and a few `private` methods become public. A mistake shows up at `tsc` time, not at run time, because the context type lists what each module reads. Estimated 9 small commits.

## Option B: stop at what is easy

Keep `main.ts` and `sketch.ts` as they are now (about 1700 and 2130 lines) and only move modules that need no shared state (done so far). Zero regression risk; the files stay large, so two agents still cannot work on one file in parallel.

## Option C: classes for main

Turn `main.ts` into several controller classes owning their slice of state (a `SelectionController`, `PreviewController`, `ToolStrip`) that talk through callbacks. Cleanest end state, but it changes how every function reaches state at once, and it is the most likely to cause the regressions you want to avoid. Not recommended before an alpha.

## Open questions for the owner

1. Option A, B or C?
2. If A: start with `main.ts` (slices 1 to 4) or `sketch.ts` (slices 1 to 4)? Recommendation: `sketch.ts` builders first (smallest context, geometry already separate), then `bodyactions.ts`.
3. May the `private` methods that the context needs become public (a naming note in the code says "used by extracted modules")? This is the only visible API change.
4. After each slice an unattended run may carry on with the next without a hand test, or stop after every two slices for you to look at the app? Default if unanswered: carry on, with a Chrome check per slice.
