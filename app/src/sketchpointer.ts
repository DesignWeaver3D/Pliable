/** Pointer handling of the sketch mode: hover, press, drag of points and curves, box selection, and the clicks that place a shape. */
import * as M from "./sketchmodel.ts";
import * as Sn from "./sketchsnap.ts";
import { cornerClick, cutClick, tangentClick } from "./sketchclicks.ts";
import { addTangentArc, tangentStart } from "./sketchtangentarc.ts";
import { addArcRadius, arcClick } from "./sketcharcoptions.ts";
import { isFreeCircle, draggedRadius } from "./sketchcircledrag.ts";
import type { Snap } from "./sketchtypes.ts";
import { pushUndo } from "./sketchundo.ts";
import { pickToProject } from "./sketchproject.ts";
import { resolveSketch } from "./sketchrefresh.ts";
import { renderSketch } from "./sketchrender.ts";
import type { SketchMode } from "./sketch.ts";

const DRAG_START_PX = 3;

export function updateBox(mode: SketchMode, e: PointerEvent) {
  const b = mode.box!;
  b.x1 = e.clientX;
  b.y1 = e.clientY;
  if (!b.active && Math.hypot(b.x1 - b.x0, b.y1 - b.y0) < DRAG_START_PX) return;
  b.active = true;
  if (!mode.boxEl) {
    mode.boxEl = document.createElement("div");
    mode.boxEl.style.cssText = "position:fixed;pointer-events:none;z-index:2;border:1px solid #4fc3f7;background:rgba(79,195,247,0.12)";
    document.body.appendChild(mode.boxEl);
  }
  const crossing = b.x1 < b.x0;
  Object.assign(mode.boxEl.style, {
    left: Math.min(b.x0, b.x1) + "px",
    top: Math.min(b.y0, b.y1) + "px",
    width: Math.abs(b.x1 - b.x0) + "px",
    height: Math.abs(b.y1 - b.y0) + "px",
    borderStyle: crossing ? "dashed" : "solid", // dashed = crossing, solid = window
    borderColor: crossing ? "#8bc34a" : "#4fc3f7",
  });
}

export function cancelBox(mode: SketchMode) {
  mode.box = null;
  mode.boxEl?.remove();
  mode.boxEl = null;
}

/** Select the sketch's own points and curves in the box (never the model's faces or edges). */
export function finishBox(mode: SketchMode) {
  const b = mode.box!;
  cancelBox(mode);
  if (!b.active) {
    if (!b.additive) mode.selection = []; // a click on empty space
    return;
  }
  const rect = mode.viewport.renderer.domElement.getBoundingClientRect();
  const r = { x0: Math.min(b.x0, b.x1) - rect.left, x1: Math.max(b.x0, b.x1) - rect.left, y0: Math.min(b.y0, b.y1) - rect.top, y1: Math.max(b.y0, b.y1) - rect.top };
  const found = M.itemsInBox(mode.s, (u, v) => mode.screenOf(u, v), r, b.x1 < b.x0);
  mode.selection = b.additive ? [...mode.selection, ...found.filter((f) => !mode.selection.some((s) => s.kind === f.kind && s.id === f.id))] : found;
  mode.boxSelection = mode.selection; // while this is still the selection, Delete treats its points as picked by a box
}

export function onMove(mode: SketchMode, e: PointerEvent) {
  // A release the page never saw (focus lost, a dialog) must not leave a drag or box stuck to the pointer.
  if (e.buttons === 0 && (mode.box || mode.drag)) {
    cancelBox(mode);
    mode.drag = null;
    mode.clickToggle = null;
  }
  if (mode.box) {
    updateBox(mode, e);
    return;
  }
  if (mode.drag) {
    const dx = e.clientX - mode.drag.startX;
    const dy = e.clientY - mode.drag.startY;
    if (!mode.drag.moved && Math.hypot(dx, dy) < DRAG_START_PX) return;
    if (!mode.drag.moved) pushUndo(mode);
    mode.drag.moved = true;
    const uv = mode.planeUV(e);
    const body = mode.drag.body;
    const resized = mode.drag.resize !== undefined ? mode.s.entities.find((x) => x.id === mode.drag!.resize) : undefined;
    if (uv && resized && resized.type === "circle") {
      const c = mode.s.points.find((p) => p.id === resized.center);
      if (c) resized.radius = draggedRadius(c, uv[0], uv[1]); // a free circle dragged by its rim: the center stays, the radius follows the pointer
      renderSketch(mode);
    } else if (uv && body) resolveSketch(mode, { points: body.points.map((p) => ({ point: p.id, u: p.u + uv[0] - body.u, v: p.v + uv[1] - body.v })) });
    else if (uv) {
      const at = Sn.snapDragged(mode, uv, [mode.drag.id]); // onto the grid, the axes, or in line with another point
      mode.cursor = at.guides ? at : null; // the guide lines show while dragging
      resolveSketch(mode, { point: mode.drag.id, u: at.u, v: at.v });
    }
    return;
  }
  if (mode.tool === "select" || mode.tool === "trim" || mode.tool === "extend" || mode.tool === "split" || mode.tool === "fillet" || mode.tool === "chamfer" || mode.tool === "tancircle" || mode.tool === "tanarc") mode.hover = mode.pick(e);
  else mode.cursor = mode.snap(e);
  renderSketch(mode);
}

export function onDown(mode: SketchMode, e: PointerEvent) {
  if (mode.projectPick !== null) return pickToProject(mode, e);
  if (mode.tool !== "select") return;
  if (mode.selectedDimensions.size) {
    mode.selectedDimensions.clear(); // a click anywhere but on a dimension's value ends the dimension selection
    renderSketch(mode, false);
  }
  const hit = mode.pick(e);
  const additive = e.ctrlKey || e.metaKey || e.shiftKey;
  const same = (s: M.SketchSel) => !!hit && s.kind === hit.kind && s.id === hit.id;
  const wasSelected = mode.selection.some(same);
  mode.clickToggle = null;
  if (!hit) {
    // Empty space: a click clears the selection, a drag draws a selection box (see finishBox).
    mode.box = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, active: false, additive };
    mode.viewport.renderer.domElement.setPointerCapture(e.pointerId);
  } else if (additive) {
    mode.selection = wasSelected ? mode.selection.filter((s) => !same(s)) : [...mode.selection, hit];
  } else if (wasSelected) {
    mode.clickToggle = { sel: hit, x: e.clientX, y: e.clientY }; // decided on release: a drag moves the whole selection instead
  } else {
    mode.selection = [...mode.selection, hit]; // clicking adds: no modifier key needed
  }
  if (hit && !additive) startDrag(mode, e, wasSelected ? mode.selection : [hit]);
  renderSketch(mode);
}

/** Begin dragging the given items: one point follows the pointer; curves and several items move as a whole, the rest follows the constraints. */
export function startDrag(mode: SketchMode, e: PointerEvent, items: M.SketchSel[]) {
  const uv = mode.planeUV(e);
  if (!uv) return;
  const point = (id: number) => mode.s.points.find((p) => p.id === id);
  if (items.length === 1 && items[0].kind === "point") {
    if (point(items[0].id)?.fixed) return;
    mode.drag = { id: items[0].id, startX: e.clientX, startY: e.clientY, moved: false };
    mode.viewport.renderer.domElement.setPointerCapture(e.pointerId);
    return;
  }
  if (items.length === 1 && items[0].kind === "entity" && isFreeCircle(mode.s, items[0].id)) {
    mode.drag = { id: 0, startX: e.clientX, startY: e.clientY, moved: false, resize: items[0].id };
    mode.viewport.renderer.domElement.setPointerCapture(e.pointerId);
    return;
  }
  const ids = new Set<number>();
  for (const it of items) {
    if (it.kind === "point") {
      if (!point(it.id)?.fixed) ids.add(it.id);
      continue;
    }
    const entity = mode.s.entities.find((x) => x.id === it.id);
    if (!entity || entity.reference) continue;
    // An ellipse is held by its center and major end only: its other axis ends follow, and pinning all five over-constrains the solver (many retries, a laggy drag).
    const held = (entity.type === "ellipse" ? [entity.center, entity.major, ...(entity.start !== undefined ? [entity.start, entity.end!] : [])] : M.entityPoints(entity)).map(point);
    if (M.entityPoints(entity).every((id) => !point(id)?.fixed) && held.every((p) => p)) for (const p of held) ids.add(p!.id);
  }
  if (!ids.size) return;
  const held = [...ids].map((id) => point(id)!);
  mode.drag = { id: 0, startX: e.clientX, startY: e.clientY, moved: false, body: { u: uv[0], v: uv[1], points: held.map((p) => ({ id: p.id, u: p.u, v: p.v })) } };
  mode.viewport.renderer.domElement.setPointerCapture(e.pointerId);
}

export async function onUp(mode: SketchMode, e: PointerEvent) {
  if (mode.box) {
    finishBox(mode);
    renderSketch(mode);
    return;
  }
  const toggle = mode.clickToggle;
  mode.clickToggle = null;
  if (toggle && Math.hypot(e.clientX - toggle.x, e.clientY - toggle.y) < DRAG_START_PX) {
    mode.selection = mode.selection.filter((s) => !(s.kind === toggle.sel.kind && s.id === toggle.sel.id));
    mode.drag = null;
    renderSketch(mode);
    return;
  }
  if (mode.drag) {
    const moved = mode.drag.moved;
    mode.drag = null;
    mode.cursor = null;
    if (moved) {
      while (mode.solver.isSolving()) await new Promise((r) => setTimeout(r, 5)); // let the last pinned position finish first
      await resolveSketch(mode); // settle without pinning the dragged point
    }
    renderSketch(mode);
    return;
  }
  if (mode.tool === "select") return;
  if (mode.tool === "fillet" || mode.tool === "chamfer") {
    cornerClick(mode, mode.pick(e), mode.planeUV(e));
    renderSketch(mode);
    return;
  }
  if (mode.tool === "tancircle" || mode.tool === "tanarc") {
    tangentClick(mode, mode.pick(e), mode.planeUV(e));
    renderSketch(mode);
    return;
  }
  if (mode.tool === "trim" || mode.tool === "extend" || mode.tool === "split") {
    cutClick(mode, mode.pick(e), mode.planeUV(e));
    renderSketch(mode);
    return;
  }
  const snap = mode.snap(e);
  if (!snap) return;
  placeClick(mode, snap);
}

/** A shape is complete: every drawing tool but Line is left for Select, so the next click selects (smarter continuing is on the watchlist). */
export function shapeDone(mode: SketchMode) {
  mode.chain = [];
  mode.setTool("select");
}

/** Add the next point of the shape being drawn, from a click or a typed size; finishes the shape when it has enough points. */
export function placeClick(mode: SketchMode, snap: Snap) {
  if (mode.tool === "arctan" && mode.chain.length === 0) {
    const start = tangentStart(mode.s, snap);
    if (typeof start === "string") return mode.host.status(start, true);
    snap = start;
  }
  if (mode.tool === "arc" && !mode.placingTyped && mode.chain.length >= 1 && mode.chain.length <= 2) snap = arcClick(mode.chain, snap, mode.arcOptions);
  mode.chain.push(snap);
  if (mode.tool === "line") {
    if (mode.chain.length >= 2) {
      const closed = mode.addLine(mode.chain[mode.chain.length - 2], snap);
      if (closed) endChain(mode);
      else mode.chain = [snap];
    }
  } else if (mode.tool === "spline") {
    const first = mode.chain[0];
    if (mode.chain.length >= 3 && snap.id !== undefined && snap.id === first.id) {
      mode.chain.pop();
      mode.addSpline(true);
      shapeDone(mode);
      return;
    }
  } else if (mode.tool === "ellipse" && mode.chain.length === 3) {
    mode.addEllipse(mode.chain[0], mode.chain[1], mode.chain[2]);
    shapeDone(mode);
  } else if (mode.tool === "ellarc" && mode.chain.length === 5) {
    mode.addEllipseArc(mode.chain[0], mode.chain[1], mode.chain[2], mode.chain[3], mode.chain[4]);
    shapeDone(mode);
  } else if ((mode.tool === "rectangle" || mode.tool === "rectcentre") && mode.chain.length === 2) {
    mode.addRectangle(mode.chain[0], mode.chain[1], mode.tool === "rectcentre");
    shapeDone(mode);
  } else if (mode.tool === "circle" && mode.chain.length === 2) {
    mode.addCircle(mode.chain[0], mode.chain[1]);
    shapeDone(mode);
  } else if (mode.sidesOf(mode.tool) && mode.chain.length === 2) {
    mode.addPolygon(mode.chain[0], mode.chain[1], mode.sidesOf(mode.tool)!);
    shapeDone(mode);
  } else if (mode.tool === "arc" && mode.chain.length === 3) {
    mode.addArc(mode.chain[0], mode.chain[1], mode.chain[2]);
    shapeDone(mode);
  } else if (mode.tool === "arc3" && mode.chain.length === 3) {
    mode.addArcThrough(mode.chain[0], mode.chain[2], mode.chain[1]); // clicked start, end, then the point it passes through
    shapeDone(mode);
  } else if (mode.tool === "arcrad" && mode.chain.length === 3) {
    addArcRadius(mode, mode.chain[0], mode.chain[1], mode.chain[2], mode.arcOptions.radius);
    shapeDone(mode);
  } else if (mode.tool === "arctan" && mode.chain.length === 2) {
    addTangentArc(mode, mode.chain[0], mode.chain[1]);
    shapeDone(mode);
  } else if (mode.tool === "circle3" && mode.chain.length === 3) {
    mode.addCircleThrough(mode.chain[0], mode.chain[1], mode.chain[2]);
    shapeDone(mode);
  } else if (mode.tool === "slot" && mode.chain.length === 3) {
    mode.addSlot(mode.chain[0], mode.chain[1], mode.chain[2]);
    shapeDone(mode);
  } else if (mode.tool === "point") {
    pushUndo(mode);
    mode.pointFor(snap);
    shapeDone(mode);
    resolveSketch(mode);
  }
  mode.cursor = null;
  renderSketch(mode);
}

export function endChain(mode: SketchMode) {
  mode.typed = "";
  if (mode.tool === "spline" && mode.chain.length >= 2) {
    mode.addSpline(false);
    return shapeDone(mode);
  }
  mode.chain = [];
  mode.chainStart = undefined;
  mode.cursor = null;
  renderSketch(mode);
}
