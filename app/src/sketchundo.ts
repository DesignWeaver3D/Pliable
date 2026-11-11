/** Undo and redo inside the open sketch. */
import { syncPlane } from "./sketchplanemove.ts";
import { resolveSketch } from "./sketchrefresh.ts";
import { renderSketch } from "./sketchrender.ts";
import type { SketchMode } from "./sketch.ts";

export function pushUndo(mode: SketchMode) {
  mode.undoStack.push(JSON.stringify(mode.s));
  mode.redoStack = [];
  if (mode.undoStack.length > 100) mode.undoStack.shift();
}

/** Step back or forward through the sketch's own edits (the top bar's Undo and Redo and the keys do this while a sketch is edited). */
export function undoStep(mode: SketchMode, kind: "undo" | "redo") {
  const from = kind === "undo" ? mode.undoStack : mode.redoStack;
  const to = kind === "undo" ? mode.redoStack : mode.undoStack;
  const next = from.pop();
  if (!next) return;
  mode.trimCandidates.clear();
  to.push(JSON.stringify(mode.s));
  mode.s = JSON.parse(next);
  mode.selection = [];
  mode.chain = [];
  syncPlane(mode);
  resolveSketch(mode);
  renderSketch(mode);
}
