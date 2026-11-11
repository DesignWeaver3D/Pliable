/** SVG building blocks of the dimension overlay: its sizes and colors, 2D vector helpers, and the lines, arrows and halos the dimensions are drawn with. */

export const DIM_OFFSET_PX = 36; // distance of a linear dimension line from the measured points
export const EXT_OVERSHOOT_PX = 6; // extension lines run this far past the dimension line
export const EXT_GAP_PX = 3; // and start this far from the measured points
export const ARROW_PX = 9;
export const LEADER_PX = 34; // a leader runs this far beyond the feature before its landing
export const LANDING_PX = 14; // the short horizontal landing the text sits at the end of
export const TEXT_PX = 13;
export const DOUBLE_TAP_MS = 450; // two taps closer in time than this are a double-click
export const DRAG_START_PX = 4; // a press that moves less than this is a click, not a drag
export const MARK_ICON_PX = 18; // a constraint mark drawn as its button's icon
export const MARK_VERTEX_PX = 5; // half the size of a vertex square
export const MARK_GAP_PX = 3; // clear space between a vertex square and a mark placed beside it
export const CURSOR_CLEAR_PX = 28; // text moves away when the pointer is closer than this
/** Leaders, extension lines, dimension lines, arrowheads and the values use the off-white of the UI buttons (the --ui-offwhite token in index.html). */
export const LINE_COLOR = "var(--ui-offwhite, #ddd)";
/** The dark outline under all of them, so they stay readable over light surfaces. */
export const HALO_COLOR = "#1b1d22";
/** Reference dimensions are drawn in the construction gray (the same as construction curves in a sketch). */
export const REFERENCE_COLOR = "#7f8794";
export const GAP_PAD_PX = 3; // room kept clear of the dimension's own lines around a value
export const HALO_OPACITY = "0.6"; // see-through, so it reads as a soft shadow rather than a hard outline
export const NS = "http://www.w3.org/2000/svg";

export type V = { x: number; y: number };
export const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y });
export const mul = (a: V, k: number): V => ({ x: a.x * k, y: a.y * k });
export const len = (a: V) => Math.hypot(a.x, a.y);
export const unit = (a: V): V => (len(a) < 1e-6 ? { x: 1, y: 0 } : mul(a, 1 / len(a)));

/** How far the line of a radius or diameter stays from the center point it measures from. */
export const CENTER_CLEAR_PX = 7;

export const HIT_STYLE = (() => {
  const style = document.createElementNS(NS, "style");
  style.textContent = ".dimhit { fill: rgba(255,138,31,0); stroke: none; pointer-events: all; } .dimhit.drag { cursor: move; } .dimhit.edit { cursor: text; } .dimhit.edit:hover { fill: rgba(255,138,31,0.16); stroke: #ff8a1f; stroke-width: 1; }";
  return style;
})();

export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Axis-aligned overlap of two text boxes (rotated text is approximated by its unrotated box). */
export function overlaps(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/** How wide a value is drawn, in pixels, with a little room around it. */
export function textWidth(text: string) {
  return text.length * TEXT_PX * 0.55 + 8;
}

/** Swap the dimension color for the reference gray in an element and what it holds (the selected orange is left alone). */
export function recolour(el: Element) {
  const style = el.getAttribute("style");
  if (style?.includes(LINE_COLOR)) el.setAttribute("style", style.split(LINE_COLOR).join(REFERENCE_COLOR));
  for (const child of Array.from(el.children)) recolour(child);
}

/** The parts of a line across a circle that may be clicked: clear of both ends, and for a diameter (which passes through the center) of its middle too. */
export function halves(el: SVGElement, throughCentre: boolean): SVGElement[] {
  const [x1, y1, x2, y2] = ["x1", "y1", "x2", "y2"].map((k) => Number(el.getAttribute(k)));
  const [mx, my] = [(x1 + x2) / 2, (y1 + y2) / 2];
  const piece = (ax: number, ay: number, bx: number, by: number) => {
    const copy = el.cloneNode(false) as SVGElement;
    for (const [k, v] of [["x1", ax], ["y1", ay], ["x2", bx], ["y2", by]] as const) copy.setAttribute(k, String(v));
    trimEnds(copy, 16);
    return copy;
  };
  return throughCentre ? [piece(x1, y1, mx, my), piece(mx, my, x2, y2)] : [piece(x1, y1, x2, y2)];
}

/** Shorten a drawn line (x1..y2 attributes) by `by` pixels at each end; a line shorter than that has no hit area. */
export function trimEnds(el: SVGElement, by: number) {
  const [x1, y1, x2, y2] = ["x1", "y1", "x2", "y2"].map((k) => Number(el.getAttribute(k)));
  const length = Math.hypot(x2 - x1, y2 - y1);
  if (length <= 2 * by) {
    el.setAttribute("x2", String(x1)); // nothing left to click
    el.setAttribute("y2", String(y1));
    return;
  }
  const [ux, uy] = [(x2 - x1) / length, (y2 - y1) / length];
  el.setAttribute("x1", String(x1 + ux * by));
  el.setAttribute("y1", String(y1 + uy * by));
  el.setAttribute("x2", String(x2 - ux * by));
  el.setAttribute("y2", String(y2 - uy * by));
}

export function line(a: V, b: V): SVGElement {
  const l = document.createElementNS(NS, "line");
  l.setAttribute("x1", String(a.x));
  l.setAttribute("y1", String(a.y));
  l.setAttribute("x2", String(b.x));
  l.setAttribute("y2", String(b.y));
  l.setAttribute("style", `stroke: ${LINE_COLOR}`);
  l.setAttribute("stroke-width", "1.5");
  return l;
}

/** A wider dark copy of a line, drawn under it. */
export function lineHalo(el: SVGElement): SVGElement {
  const h = el.cloneNode(false) as SVGElement;
  h.setAttribute("style", `stroke: ${HALO_COLOR}; pointer-events: none`);
  h.setAttribute("stroke-opacity", HALO_OPACITY);
  h.setAttribute("stroke-width", "3");
  return h;
}

/** Filled arrowhead with its tip at `tip`, pointing along `dir`. */
export function arrow(tip: V, dir: V): SVGElement {
  const back = sub(tip, mul(dir, ARROW_PX));
  const n = { x: -dir.y, y: dir.x };
  const p = document.createElementNS(NS, "polygon");
  const pts = [tip, add(back, mul(n, ARROW_PX / 3)), sub(back, mul(n, ARROW_PX / 3))];
  p.setAttribute("points", pts.map((q) => `${q.x},${q.y}`).join(" "));
  p.setAttribute("style", `fill: ${LINE_COLOR}`);
  p.setAttribute("stroke", HALO_COLOR);
  p.setAttribute("stroke-opacity", HALO_OPACITY);
  p.setAttribute("stroke-width", "2");
  p.setAttribute("stroke-linejoin", "round");
  p.setAttribute("paint-order", "stroke");
  return p;
}
