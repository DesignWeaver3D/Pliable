/** Dragging a handle or face in the view: one preview request in flight with the newest distance winning, the dimension label that
 *  follows the pointer (and takes typed values), and the commit or cancel on release. Moved out of main.ts. */
import type { CoreClient, MeshData } from "./client";
import type { DimensionOverlay } from "./dimensions";
import type { MeasurePanel } from "./measure";
import type { ToolInfo } from "./tools";
import type { Sel, Viewport } from "./viewport";
import { app } from "./appstate";
import { LENGTH_UNIT } from "./units";
import { showNumber } from "./precision.ts";
import { dragParam } from "./tools";
import { expand } from "./relatedrules";
import { usage } from "./usage";

export interface ItemDragDeps {
  viewport: Viewport;
  core: CoreClient;
  status: HTMLElement;
  latency: HTMLElement;
  dimLabel: HTMLElement;
  measurePanel: MeasurePanel;
  dimensionOverlay: DimensionOverlay;
  /** The tool the user armed in the toolbar or palette, read at call time. */
  readonly armedTool: string | null;
  dragToolFor(sels: Sel[]): ToolInfo | null;
  show(mesh: MeshData, frame?: boolean): void;
  setCommitted(mesh: MeshData, frame?: boolean, sels?: Sel[]): void;
  setSelection(sels: Sel[]): void;
  selectionPayload(sels: Sel[]): Record<string, unknown>;
  mappedSelection(mesh: MeshData): Sel[];
  rememberOp(tool: ToolInfo | null, sels: Sel[], distance: number): void;
  /** The Push/Pull card: opened when a push/pull drag starts, it shows the distance the drag is at. */
  pushPullCard: { open(): void; showDistance(value: number): void; clearDistance(): void };
}

export function createItemDrag(d: ItemDragDeps) {
  const { viewport, core, status, latency, dimLabel, measurePanel, dimensionOverlay, dragToolFor, show, setCommitted, selectionPayload, mappedSelection, rememberOp } = d;
  // Push/pull drag: one preview request in flight, the newest distance wins.
  let session = 0; // bumped when a drag ends, so late replies are dropped
  let inFlight: Promise<void> | null = null;
  let queued: number | null = null;
  let lastGood: number | null = null; // newest distance whose preview succeeded
  let previewFailed = false; // the newest preview request failed (size past the limit)
  let dragSels: Sel[] | null = null;

  // Shift held when a push/pull drag starts makes the whole drag symmetric (about a plane, see the core's symmetric push/pull); so does the card's Symmetric box.
  let shiftHeld = false;
  let dragSymmetric = false;
  const pushPullDragging = () => dragSels !== null && dragToolFor(dragSels)?.id === "push_pull";
  for (const type of ["keydown", "keyup"] as const) {
    window.addEventListener(type, (e) => {
      shiftHeld = e.shiftKey;
      // Alt held at any time during a push/pull drag makes it a New body (the state at release decides); letting go brings the card's choice back.
      const altChanged = viewport.pushPull.altHeld !== e.altKey;
      viewport.pushPull.setAlt(e.altKey);
      if (e.key === "Alt" && pushPullDragging()) e.preventDefault(); // so the browser's menu does not take the focus
      // Pressing or letting go of Shift during a push/pull drag switches the symmetric mode from then on and previews it at once.
      const symmetric = shiftHeld || viewport.pushPull.symmetric;
      if (pushPullDragging() && (dragSymmetric !== symmetric || altChanged)) {
        dragSymmetric = symmetric;
        queued = dragValue;
        pump(session);
      }
    });
  }
  window.addEventListener("blur", () => {
    shiftHeld = false;
    viewport.pushPull.setAlt(false);
  });

  function toolRequest(sels: Sel[], distance: number, commit = false) {
    const tool = dragToolFor(sels)!;
    const params: Record<string, number | string | boolean> = { [dragParam(tool)!]: distance };
    if (tool.id === "push_pull" && dragSymmetric) params.symmetric = 1;
    if (tool.id === "push_pull") Object.assign(params, viewport.pushPull.params()); // mode and flip, set on the card (Alt: New body)
    if (tool.id === "push_pull") Object.assign(params, viewport.pullDirection.params()); // the chosen direction (pulldir.ts), for the arrow handle and the face drag alike
    // Pulling a just-picked sketch region: the pick and the extrusion are one undo step.
    const foldPick = commit && app.pendingProfile !== null && app.committed === app.pendingProfile.mesh ? { foldPick: true } : {};
    return { tool: tool.id, selection: selectionPayload(expand(tool, sels)), params, ...foldPick };
  }

  function pump(token: number) {
    if (inFlight || queued === null || dragSels === null) return;
    const distance = queued;
    queued = null;
    const sent = performance.now();
    inFlight = core
      .request<MeshData>("tool_preview", toolRequest(dragSels, distance))
      .then((mesh) => {
        if (token !== session) return;
        lastGood = distance;
        previewFailed = false;
        status.classList.remove("error");
        show(mesh);
        viewport.selectItems(mappedSelection(mesh));
        const t = mesh.header.timings ?? {};
        latency.textContent = `preview ${Math.round(performance.now() - sent)} ms (op ${t.opMs} + mesh ${t.meshMs})`;
      })
      .catch((e) => {
        if (token !== session) return;
        // Keep showing the last size that worked (smooth), but say plainly that the
        // requested size is past the limit; releasing commits the last good size.
        previewFailed = true;
        status.textContent = lastGood === null || /^Nothing to subtract/.test(e.message) ? e.message : `limit reached (${e.message})`; // a subtract that removes nothing says so, it is no size limit
        status.classList.add("error");
      })
      .finally(() => {
        inFlight = null;
        pump(token);
      });
  }

  // Dimension label: follows the pointer during a drag; typing digits turns it into the value entry.
  const DIM_OFFSET_PX = 16; // label offset from the pointer
  const len = (n: number) => `${showNumber(n)} ${LENGTH_UNIT}`;
  let typed: string | null = null; // text typed so far, null while the mouse sets the value
  let dragValue = 0; // value from the mouse (model units)
  let typedNegative = false; // sign of the typed value: starts as the drag direction, "-" flips it

  /** The number sent to the core: the typed value if it parses, else the mouse value. */
  function effectiveValue(): number {
    const n = typed === null || typed === "" ? NaN : Number(typed);
    if (!Number.isFinite(n)) return dragValue;
    const m = viewport.measureMode ? viewport.measureSel : null;
    // In measure mode the typed number is the edge's new length; the face moves by the difference.
    return m ? m.grow * (n - m.length) : typedNegative ? -n : n;
  }

  function renderDim() {
    const entering = typed !== null;
    dimLabel.classList.toggle("entry", entering);
    const m = viewport.measureSel ?? viewport.primaryMeasure;
    const was = m ? len(m.length) : "";
    if (viewport.measureMode && m) {
      const shown = entering ? `${typed}| ${LENGTH_UNIT}` : len(m.length + m.grow * effectiveValue());
      dimLabel.textContent = `edge ${shown}\nwas ${was} (face ${len(effectiveValue())})`;
      return;
    }
    const value = entering ? `${typedNegative ? "-" : ""}${typed}| ${LENGTH_UNIT}` : len(dragValue);
    const context = m ? `\nedge ${was} → ${len(m.length + m.grow * dragValue)}` : "";
    dimLabel.textContent = value + context;
  }

  function hideDim() {
    typed = null;
    dimLabel.hidden = true;
  }

  function installKeys() {
    // Right-click during a drag toggles measure mode; picking another edge or leaving it drops any typed text.
    viewport.onMeasureChange = () => {
      typed = null;
      if (viewport.measureMode) {
        status.classList.remove("error");
        status.textContent = "Measure mode: click an edge, type its length, Enter to apply, Esc to go back";
      }
      renderDim();
    };

    window.addEventListener("keydown", (e) => {
      // A direction arc being dragged owns the keyboard too: typed degrees set its tilt (see PullGizmo.key).
      if (viewport.pullGizmo.dragging && !e.ctrlKey && !e.metaKey && !e.altKey && viewport.pullGizmo.key(e)) {
        e.preventDefault();
        return;
      }
      // A handle being dragged owns the keyboard: typed digits set its value (see Manipulator.key).
      if (viewport.manipulator.dragging && !e.ctrlKey && !e.metaKey && !e.altKey && viewport.manipulator.key(e)) {
        e.preventDefault();
        return;
      }
      if (!viewport.dragging || e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[0-9.-]$/.test(e.key)) {
        if (e.key === "-" && viewport.measureMode) return; // lengths are not signed
        if (typed === null) {
          typed = "";
          typedNegative = dragValue < 0; // the drag already chose the direction
          viewport.holdDrag = true;
        }
        if (e.key === "-") typedNegative = !typedNegative;
        else typed += e.key;
      } else if (e.key === "Backspace" && typed !== null) {
        typed = typed.slice(0, -1);
      } else if (e.key === "Enter" && typed !== null) {
        viewport.finishDrag();
        return;
      } else if (e.key === "Escape" && typed !== null) {
        // Button still held (or measure mode): the first Escape leaves entry and goes back to the mouse. Button already up: Escape cancels the drag.
        if (!viewport.measureMode && viewport.dragReleased) {
          typed = null;
          viewport.cancelDrag();
          return;
        }
        typed = null;
        viewport.holdDrag = viewport.measureMode;
        renderDim();
        return;
      } else if (e.key === "Escape" && viewport.measureMode) {
        viewport.exitMeasure();
        return;
      } else return;
      // The preview stays where the mouse left it until Enter, so entry can finish before geometry moves.
      e.preventDefault();
      renderDim();
    });
  }

  async function onItemDrag(sels: Sel[], distance: number, phase: "move" | "end" | "cancel", x = 0, y = 0) {
    if (phase === "move") {
      if (!dragToolFor(sels)) return;
      dragValue = distance;
      dimLabel.hidden = false;
      measurePanel.hide();
      app.measuredDims = []; app.previewDimsShown = false; dimensionOverlay.set([]);
      if (dragToolFor(sels)?.id === "push_pull") d.pushPullCard.showDistance(distance);
      dimLabel.style.left = `${x + DIM_OFFSET_PX}px`;
      dimLabel.style.top = `${y + DIM_OFFSET_PX}px`;
      renderDim();
      if (dragSels === null) {
        lastGood = null;
        previewFailed = false;
        dragSymmetric = shiftHeld || viewport.pushPull.symmetric;
        const dragTool = dragToolFor(sels)!;
        if (dragTool.id === "push_pull") {
          d.pushPullCard.open(); // a push/pull drag always opens its card
          d.pushPullCard.showDistance(distance);
        }
        if (d.armedTool !== dragTool.id) usage.record(dragTool.id, "start", "drag"); // an armed tool already counted its start
      }
      dragSels = sels;
      queued = distance;
      pump(session);
      return;
    }
    // End or cancel: stop previews, let the in-flight one finish, then settle.
    if (phase === "end" && typed !== null) distance = effectiveValue();
    else if (phase === "end") distance = dragValue;
    hideDim();
    d.pushPullCard.clearDistance();
    session++;
    queued = null;
    try {
      await inFlight;
    } catch {
      // a failed preview must not leave the drag state set
    }
    dragSels = null;
    const good = lastGood;
    if (phase === "end" && previewFailed && good !== null) distance = good;
    lastGood = null;
    previewFailed = false;
    const dragTool = dragToolFor(sels);
    try {
      if (!(phase === "end" && Math.abs(distance) > 1e-6) && dragTool) usage.record(dragTool.id, "cancel");
      if (phase === "end" && Math.abs(distance) > 1e-6) {
        const start = performance.now();
        let mesh: MeshData;
        try {
          mesh = await core.request<MeshData>("tool_commit", toolRequest(sels, distance, true));
        } catch (e) {
          // The final size can fail when the last preview reply was dropped at release;
          // fall back to the newest size known to work.
          if (good === null || good === distance) throw e;
          mesh = await core.request<MeshData>("tool_commit", toolRequest(sels, good, true));
        }
        setCommitted(mesh, false, mappedSelection(mesh));
        rememberOp(dragToolFor(sels), sels, distance);
        if (dragTool) usage.record(dragTool.id, "commit");
        latency.textContent = `commit ${Math.round(performance.now() - start)} ms`;
      } else if (app.committed) {
        setCommitted(app.committed, false, sels);
      }
    } catch (e) {
      if (dragTool) usage.record(dragTool.id, "error");
      if (app.committed) setCommitted(app.committed, false, sels);
      status.textContent = (e as Error).message; // after setCommitted, which rewrites the status
      status.classList.add("error");
    }
    dragSymmetric = false;
  }

  return { isDragging: () => dragSels !== null, installKeys, onItemDrag };
}
