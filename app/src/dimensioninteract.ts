/** Pointer interaction with a drawn dimension: the hit areas over its text and lines, dragging it, and the click or double tap that edits it. */
import { DOUBLE_TAP_MS, DRAG_START_PX, NS, type V, halves } from "./dimensionsvg.ts";
import type { Dimension, DimensionOverlay } from "./dimensions.ts";

/** The part of the DimensionOverlay this file uses. */
export type DimInteractContext = Pick<DimensionOverlay, "activatedAt" | "current" | "dims" | "drewLabel" | "lastTap" | "onActivate" | "tapDown">;

/** An invisible rectangle over the text: the tooltip, the hover look and the double-click that opens the inline editor. */
export function hitArea(ov: DimInteractContext, half: V, dim: Dimension, at: V): SVGElement {
  const index = ov.current;
  const r = document.createElementNS(NS, "rect");
  r.setAttribute("x", String(-half.x));
  r.setAttribute("y", String(-half.y));
  r.setAttribute("width", String(half.x * 2));
  r.setAttribute("height", String(half.y * 2));
  r.setAttribute("rx", "3");
  r.setAttribute("class", (dim.edit || dim.activate ? "dimhit edit" : "dimhit") + (dim.drag ? " drag" : ""));
  const tip = document.createElementNS(NS, "title");
  tip.textContent = dim.edit || dim.activate ? "Double-click to edit" + (dim.drag ? ", drag to move" : "") : (dim.editNote ?? (dim.drag ? "Drag to move" : dim.mark && dim.select ? "Click to select, Delete removes it" : ""));
  r.append(tip);
  // The pointer gestures on the text belong to the text: they must not reach the viewport (which would clear the selection).
  for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup"]) r.addEventListener(type, (e) => e.stopPropagation());
  makeDraggable(ov, r, dim);
  // Selecting happens on the press, not on the click: the drawing is rebuilt when the pointer moves, and a click is lost when its element is replaced between press and release.
  if (dim.select) r.addEventListener("pointerdown", (e) => e.button === 0 && dim.select!(e));
  if (dim.menu) {
    r.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dim.menu!(e);
    });
  }
  if (dim.activate) {
    activateOnDoubleTap(ov, r, dim, () => dim.activate!(at));
    r.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      activateOnce(ov, () => dim.activate!(at));
    });
  } else if (dim.edit) {
    r.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      ov.onActivate?.(index, at);
    });
    r.addEventListener("click", (e) => {
      if (ov.dims.length === 1) {
        e.stopPropagation();
        ov.onActivate?.(index, at);
      }
    });
  }
  return r;
}

/** Dragging the text or a line of a dimension moves it (`dim.drag` gets the pointer); a click without movement stays a click. */
export function makeDraggable(ov: DimInteractContext, el: SVGElement, dim: Dimension) {
  if (!dim.drag) return;
  el.addEventListener("pointerdown", (down) => {
    if (down.button !== 0) return;
    const start = { x: down.clientX, y: down.clientY };
    let moving = false;
    const move = (e: PointerEvent) => {
      if (!moving && Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_START_PX) return;
      moving = true;
      dim.drag!(e);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end, true);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, true); // capture: the text and lines stop pointerup from bubbling
  });
}

/** Run the editor at most once per double-click, whichever of the two detections (the browser's dblclick, or `activateOnDoubleTap`) sees it first. */
export function activateOnce(ov: DimInteractContext, run: () => void) {
  if (Date.now() - ov.activatedAt < DOUBLE_TAP_MS) return;
  ov.activatedAt = Date.now();
  run();
}

/** Two quick taps on the same dimension open its editor even when the drawing was rebuilt between them (the browser then sends no dblclick, because the second press lands on a new element). */
export function activateOnDoubleTap(ov: DimInteractContext, el: SVGElement, dim: Dimension, run: () => void) {
  const key = dim.constraint ?? ov.current;
  el.addEventListener("pointerdown", (e) => (ov.tapDown = { x: e.clientX, y: e.clientY }));
  el.addEventListener("pointerup", (e) => {
    const down = ov.tapDown; // kept on the overlay: the drawing may be rebuilt between the press and the release
    if (e.button !== 0 || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG_START_PX) return; // a drag is not a tap
    const last = ov.lastTap;
    const now = Date.now();
    if (last && last.key === key && now - last.time < DOUBLE_TAP_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 2 * DRAG_START_PX) {
      ov.lastTap = null;
      activateOnce(ov, run);
    } else ov.lastTap = { time: now, x: e.clientX, y: e.clientY, key };
  });
}

/** Wide invisible copies of a dimension's lines, so double-clicking the leader or dimension line edits it like the text does. */
export function lineHits(ov: DimInteractContext, d: Dimension, drawn: SVGElement[]): SVGElement[] {
  const at = ov.drewLabel;
  // The line across a circle (to its center or through it) is left out: its hit area would cover the center and the curve, which stay selectable.
  const lines = drawn.filter((el) => el.tagName === "line");
  const round = d.kind === "radius" || d.kind === "diameter";
  // The line across a circle can be clicked to select the dimension, but not dragged, and not near the center (the middle of a diameter) or the curve, which stay selectable and draggable.
  const pieces = lines.flatMap((el, i) => (round && i === 0 ? halves(el, d.kind === "diameter").map((piece) => ({ el: piece, across: true })) : [{ el, across: false }]));
  return pieces
    .map(({ el, across }) => {
      const hit = el.cloneNode(false) as SVGElement;
      hit.setAttribute("stroke", "rgba(255,138,31,0)");
      hit.setAttribute("stroke-width", "12");
      hit.setAttribute("style", `pointer-events:stroke;cursor:${d.drag ? "move" : "text"}`);
      for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup"]) hit.addEventListener(type, (e) => e.stopPropagation());
      if (!across) makeDraggable(ov, hit, d);
      if (at && d.activate) activateOnDoubleTap(ov, hit, d, () => d.activate!(at));
      if (d.select) hit.addEventListener("pointerdown", (e) => e.button === 0 && d.select!(e)); // a click on a dimension's line selects it like a click on its value
      hit.addEventListener("dblclick", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (at) activateOnce(ov, () => d.activate?.(at));
      });
      return hit;
    });
}
