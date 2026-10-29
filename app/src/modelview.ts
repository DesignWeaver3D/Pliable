/** Showing a mesh and committing one as the model: the view, the body list, the history buttons and the status line. Moved out of main.ts. */
import type { CoreClient, MeshData } from "./client";
import type { DatumPlane, MirrorMode } from "./datumcorners";
import type { Dimension, DimensionOverlay } from "./dimensions";
import type { Sel, Viewport } from "./viewport";
import { showImportNotice } from "./alpha";
import { app, bodyView } from "./appstate";
import { pruneGhost, pruneHidden } from "./bodylogic";
import { bodiesOf, filterHidden } from "./visibility";

export interface ModelViewDeps {
  viewport: Viewport;
  core: CoreClient;
  status: HTMLElement;
  dimensionOverlay: DimensionOverlay;
  undoButton: HTMLButtonElement;
  redoButton: HTMLButtonElement;
  dev: boolean;
  /** Built after this module is made (or reassigned later), so read at call time. */
  readonly bodyList: { setBodies(bodies: ReturnType<typeof bodiesOf>, hidden: ReadonlySet<number>, ghost: ReadonlySet<number>, focus: number | null): void };
  readonly editLastButton: HTMLButtonElement;
  readonly sketch: { active: boolean; canUndo: boolean; canRedo: boolean; exit(): void };
  readonly loadedSample: string;
  onSketches(list: { id: number; name: string; rev: number }[]): void;
  onDatums(list: DatumPlane[], mirror: MirrorMode | null): void;
  setChosenSketch(id: number | null): void;
  setSelection(sels: Sel[]): void;
}

export function createModelView(d: ModelViewDeps) {
  const { viewport, core, status, dimensionOverlay, undoButton, redoButton, setChosenSketch, setSelection } = d;
  const DEV = d.dev;

  function show(mesh: MeshData, frame = false) {
    // A preview that keeps one face or edge selected (a hole being moved) brings the dimensions of its own model.
    const previewDims: Dimension[] | undefined = mesh.header.preview ? mesh.header.dimensions : undefined;
    if (previewDims) {
      dimensionOverlay.set(previewDims);
      app.previewDimsShown = true;
    } else if (app.previewDimsShown && !mesh.header.preview) {
      dimensionOverlay.set(app.measuredDims); // the preview ended without a commit: the committed model's dimensions again
      app.previewDimsShown = false;
    }
    bodyView.hidden = pruneHidden(bodyView.hidden, bodiesOf(mesh).map((b) => b.id));
    const pruned = pruneGhost(bodyView.ghost, bodyView.focus, bodiesOf(mesh).map((b) => b.id));
    bodyView.ghost = pruned.ghost;
    bodyView.focus = pruned.focus;
    viewport.setMesh(filterHidden(mesh, bodyView.hidden), frame);
    viewport.setGhosted(bodyView.ghost);
    viewport.subtractGhost.set(mesh.header.preview ? (mesh.ghost ?? null) : null); // the red subtract volume only during a preview
    if (mesh.header.preview && mesh.header.notice) status.textContent = mesh.header.notice; // a preview that changes nothing says why
    if (!mesh.header.preview) {
      d.bodyList.setBodies(bodiesOf(mesh), bodyView.hidden, bodyView.ghost, bodyView.focus?.body ?? null);
      d.onSketches(mesh.header.sketches ?? []);
      d.onDatums(mesh.header.datums ?? [], mesh.header.mirror ?? null);
    }
    app.modelHistory = { undo: !!mesh.header.canUndo, redo: !!mesh.header.canRedo };
    syncHistoryButtons();
  }

  /** The top bar's Undo and Redo follow the sketch's edits while a sketch is open, and the model's otherwise. */
  function syncHistoryButtons() {
    undoButton.disabled = d.sketch.active ? !d.sketch.canUndo : !app.modelHistory.undo;
    redoButton.disabled = d.sketch.active ? !d.sketch.canRedo : !app.modelHistory.redo;
  }

  function setCommitted(mesh: MeshData, frame = false, sels: Sel[] = []) {
    app.committed = mesh;
    setChosenSketch(null); // a sketch chosen with Shift+click was for the step just taken
    app.lastOp = null; // callers that commit a tool run set it again afterwards
    d.editLastButton.disabled = true;
    if (frame) { // a newly opened model: its body ids restart at 1, so the old model's hidden, see-through and focus state would hit its bodies
      d.sketch.exit(); // an open sketch belongs to the old model: left open it kept its curves and projected edges over the new one
      bodyView.hidden = new Set();
      bodyView.ghost = new Set();
      bodyView.focus = null;
    }
    show(mesh, frame);
    viewport.selectItems(sels);
    setSelection(sels);
    status.classList.remove("error");
    const warnings: string[] = mesh.header.warnings ?? [];
    if (mesh.header.solids !== undefined) showImportNotice(core, mesh.header.solids, warnings, (mesh.header.timings?.importMs ?? 0) + (mesh.header.timings?.meshMs ?? 0));
    status.textContent = `${mesh.header.name ?? d.loadedSample}: ${mesh.faces.length} faces` + (DEV ? `, ${mesh.indices.length / 3} triangles` : "") + (warnings.length ? ` | Warning: ${warnings.join("; ")}` : "");
  }

  return { show, syncHistoryButtons, setCommitted };
}
