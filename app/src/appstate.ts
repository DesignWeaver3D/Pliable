/** State shared between main.ts and the modules split out of it. Plain fields, no events: the owners read and assign them. */
import type { FocusState } from "./bodylogic";
import type { MeshData } from "./client";
import type { Dimension } from "./dimensions";
import type { RowRef } from "./listdelete";
import type { ParamValue } from "./toolpanel";
import type { ToolInfo } from "./tools";
import type { Sel } from "./viewport";

/** Which bodies are hidden, see-through or in focus (view only: not saved, not sent to the core). Ids are stable, so a
 *  hidden body stays hidden through operations. */
export const bodyView: { hidden: ReadonlySet<number>; ghost: ReadonlySet<number>; focus: FocusState | null } = {
  hidden: new Set(),
  ghost: new Set(),
  focus: null,
};

/** The page's selection and model state, read and assigned by main.ts and by the modules split out of it. */
export const app: {
  currentSels: Sel[];
  /** Ids the core says apply to currentSels (null until it replies). */
  refined: string[] | null;
  /** The kept sketch chosen with Shift or Ctrl+click on its curve in the view; kept beside the face and edge selection. */
  chosenSketch: number | null;
  keepingChosen: boolean;
  pendingProfile: { mesh: MeshData; faces: number[]; sketchId: number; regions: number[] } | null;
  askingArray: boolean;
  /** Last committed (non-preview) mesh. */
  committed: MeshData | null;
  /** The newest committed tool run, kept while nothing else has changed the model: "Edit last" undoes it and reopens its form. */
  lastOp: { tool: ToolInfo; sels: Sel[]; values: Record<string, ParamValue> } | null;
  /** The dimensions of the committed model's measurement, and whether a preview's own are on screen instead. */
  measuredDims: Dimension[];
  previewDimsShown: boolean;
  /** What the model itself can undo and redo, kept while a sketch is edited. */
  modelHistory: { undo: boolean; redo: boolean };
  pickedRow: RowRef | null;
} = {
  currentSels: [],
  refined: null,
  chosenSketch: null,
  keepingChosen: false,
  pendingProfile: null,
  askingArray: false,
  committed: null,
  lastOp: null,
  measuredDims: [],
  previewDimsShown: false,
  modelHistory: { undo: false, redo: false },
  pickedRow: null,
};
