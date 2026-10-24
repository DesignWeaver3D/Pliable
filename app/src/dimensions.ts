/** Drawing-style dimension leaders over the viewport, from the `dimensions` in the core's `measure` reply. */
import * as THREE from "three";
import { gapSegment } from "./dimensiongap";

/** What the core says an in-place edit of this dimension means (see `dimedit.py`); `blocked` is why it would fail. */
export interface DimEdit {
  kind: string;
  value: number | null;
  canFlip: boolean;
  blocked?: string;
}

export interface Dimension {
  kind: "linear" | "diameter" | "radius" | "tag" | "angle";
  text: string;
  /** Angle: the point where the lines meet, then points along the arc from one line to the other. */
  points: number[][];
  /** Angle: extension segments (a start and an end point) that carry a line out to the arc. */
  extend?: number[][][];
  offsetDirection?: number[];
  /** Set when double-clicking the text edits the value in place. */
  edit?: DimEdit;
  /** Why the value cannot be edited (the tooltip of a read-only measured dimension). */
  editNote?: string;
  /** The sketch constraint this dimension shows (sketch dimensions only). */
  constraint?: number;
  /** Set when double-clicking the text or the dimension's lines runs this (the sketch's own inline editor), given where the text is. */
  activate?: (at: { x: number; y: number }) => void;
  /** Linear: how far the dimension line sits from the measured points, signed along `offsetDirection` (world units); the pixel default when unset. */
  offset?: number;
  /** Linear: how far the text is slid along the dimension line from its middle (world units). */
  slide?: number;
  /** Leaders: where the leader bends and ends (a world point); the default direction and length when unset. */
  labelAt?: number[];
  /** Set when the dimension can be dragged to a new place: called with the pointer while it is dragged. */
  drag?: (e: PointerEvent) => void;
  /** Sketch dimensions: drawn highlighted when selected, a click on the text selects it, and a right-click on the text opens its menu. */
  /** Not a dimension value: a constraint tag (H, V, =) or a live size tag while drawing. Its lines are not cut around it. */
  mark?: boolean;
  selected?: boolean;
  select?: (e: MouseEvent) => void;
  menu?: (e: MouseEvent) => void;
}

const DIM_OFFSET_PX = 36; // distance of a linear dimension line from the measured points
const EXT_OVERSHOOT_PX = 6; // extension lines run this far past the dimension line
const EXT_GAP_PX = 3; // and start this far from the measured points
const ARROW_PX = 9;
const LEADER_PX = 34; // a leader runs this far beyond the feature before its landing
const LANDING_PX = 14; // the short horizontal landing the text sits at the end of
const TEXT_PX = 13;
const DOUBLE_TAP_MS = 450; // two taps closer in time than this are a double-click
const DRAG_START_PX = 4; // a press that moves less than this is a click, not a drag
const CURSOR_CLEAR_PX = 28; // text moves away when the pointer is closer than this
/** Leaders, extension lines, dimension lines, arrowheads and the values use the off-white of the UI buttons (the --ui-offwhite token in index.html). */
const LINE_COLOR = "var(--ui-offwhite, #ddd)";
/** The dark outline under all of them, so they stay readable over light surfaces. */
const HALO_COLOR = "#1b1d22";
const GAP_PAD_PX = 3; // room kept clear of the dimension's own lines around a value
const HALO_OPACITY = "0.6"; // see-through, so it reads as a soft shadow rather than a hard outline
const NS = "http://www.w3.org/2000/svg";

type V = { x: number; y: number };
const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: V, k: number): V => ({ x: a.x * k, y: a.y * k });
const len = (a: V) => Math.hypot(a.x, a.y);
const unit = (a: V): V => (len(a) < 1e-6 ? { x: 1, y: 0 } : mul(a, 1 / len(a)));

export class DimensionOverlay {
  private readonly svg = document.createElementNS(NS, "svg");
  private dims: Dimension[] = [];
  private pointer: V | null = null;
  /** Called when the text of an editable dimension is double-clicked (or clicked, when it is the only dimension). */
  onActivate: ((index: number, at: { x: number; y: number }) => void) | null = null;
  /** Index of the dimension whose text an inline field is covering right now. */
  editing: number | null = null;
  private labelAt = new Map<number, V>(); // where each interactive label was drawn last frame

  constructor(
    container: HTMLElement,
    private readonly camera: () => THREE.Camera,
  ) {
    this.svg.setAttribute("style", "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:hidden");
    container.append(this.svg);
    window.addEventListener("pointermove", (e) => {
      const r = this.svg.getBoundingClientRect();
      this.pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    });
  }

  private current = 0; // index of the dimension being drawn
  private drewLabel: V | null = null; // where its interactive label went
  private placed: Box[] = []; // text boxes of the dimensions drawn so far this frame
  private pending: Box[] = [];
  private clash = false;
  private drawn = ""; // what the SVG currently shows (camera, size, pointer, dimensions); unchanged means skip the redraw

  /** Called when the dimensions are replaced while an inline editor is open (the selection changed under it). */
  onReset: (() => void) | null = null;

  set(dims: Dimension[]) {
    if (this.editing !== null) this.onReset?.();
    this.dims = dims;
    this.drawn = "";
    if (dims.length === 0) this.svg.replaceChildren();
  }

  /** Redraw for the current camera; called every frame, cheap when there is nothing to show. */
  draw() {
    if (this.dims.length === 0) return;
    const rect = this.svg.getBoundingClientRect();
    const cam = this.camera();
    cam.updateMatrixWorld();
    // The pointer only matters to labels that dodge it; the interactive ones (editable or explained) stay put under it.
    const dodging = this.dims.some((d) => !d.edit && !d.editNote && !d.activate && !d.drag);
    const state = [...cam.matrixWorld.elements, ...(cam as THREE.PerspectiveCamera).projectionMatrix.elements, rect.width, rect.height, dodging ? this.pointer?.x : 0, dodging ? this.pointer?.y : 0, this.editing].join(",");
    if (state === this.drawn) return; // nothing moved: rebuilding the SVG every frame made it flicker
    this.drawn = state;
    const project = (p: number[]): V => {
      const n = new THREE.Vector3(p[0], p[1], p[2]).project(this.camera());
      return { x: ((n.x + 1) / 2) * rect.width, y: ((1 - n.y) / 2) * rect.height };
    };
    const parts: SVGElement[] = [HIT_STYLE.cloneNode(true) as SVGElement];
    this.placed = [];
    this.labelAt = new Map();
    for (const [index, d] of this.dims.entries()) {
      this.current = index;
      this.drewLabel = null;
      // A dimension whose text would land on one already drawn is left out; the measurement panel still lists it.
      const mine: SVGElement[] = [];
      this.pending = [];
      this.clash = false;
      try {
        if (d.kind === "linear") this.linear(d, project, mine);
        else if (d.kind === "tag") this.label(project(d.points[0]), d.text, mine, true);
        else if (d.kind === "angle") this.angle(d, project, mine);
        else this.leader(d, project, mine);
      } catch (e) {
        console.error("A dimension could not be drawn and was skipped:", d, e);
        continue;
      }
      if (this.clash) continue;
      const halos = mine.filter((el) => el.tagName === "line").map(lineHalo);
      if (d.activate || d.drag) mine.push(...this.lineHits(d, mine));
      if (this.drewLabel) this.labelAt.set(index, this.drewLabel);
      parts.push(...halos, ...mine);
      this.placed.push(...this.pending);
    }
    this.svg.replaceChildren(...parts);
  }

  private linear(d: Dimension, project: (p: number[]) => V, out: SVGElement[]) {
    const a = project(d.points[0]);
    const b = project(d.points[1]);
    const along = unit(sub(b, a));
    if (len(sub(b, a)) < 2) {
      // Seen end-on the two points coincide: only the value can be shown.
      this.label(a, d.text, out, true);
      return;
    }
    let side: V;
    if (d.offsetDirection) {
      const o = d.offsetDirection;
      side = sub(project(d.points[0].map((c, k) => c + o[k])), a);
      side = len(side) < 1e-3 ? { x: -along.y, y: along.x } : unit(side);
    } else {
      // A distance between two items has no natural side: put the dimension line on the upper (or right) side.
      side = { x: -along.y, y: along.x };
      if (side.y > 1e-6 || (Math.abs(side.y) <= 1e-6 && side.x < 0)) side = mul(side, -1);
    }
    let off = mul(side, DIM_OFFSET_PX);
    let slide: V = { x: 0, y: 0 };
    if (d.offset !== undefined && d.offsetDirection) {
      // Placed by the user: the line sits at the dragged distance, the text at the dragged place along it.
      const o = d.offsetDirection;
      const moved = (p: number[], k: number) => project(p.map((c, i) => c + o[i] * k));
      off = sub(moved(d.points[0], d.offset), a);
      if (d.slide) {
        const mid = d.points[0].map((c, i) => (c + d.points[1][i]) / 2);
        const dir = d.points[1].map((c, i) => c - d.points[0][i]);
        const length = Math.hypot(...dir) || 1;
        slide = sub(project(mid.map((c, i) => c + (dir[i] / length) * d.slide!)), project(mid));
      }
    }
    const a2 = add(a, off);
    const b2 = add(b, off);
    for (const [p, q] of [
      [a, a2],
      [b, b2],
    ] as const) {
      const dir = unit(sub(q, p));
      out.push(line(add(p, mul(dir, EXT_GAP_PX)), add(q, mul(dir, EXT_OVERSHOOT_PX))));
    }
    // Text pulled past either extension line: the arrows go outside the extension lines, pointing in, and the line runs on to the text.
    let pulled = slide.x * along.x + slide.y * along.y;
    // A value too wide for the room between the arrows goes past the far extension line, with the dimension line run on to it.
    const room = len(sub(b2, a2));
    const width = textWidth(d.text);
    if (Math.abs(pulled) <= room / 2 && room < width + 2 * ARROW_PX + 4) {
      pulled = room / 2 + ARROW_PX + 4 + width / 2;
      slide = mul(along, pulled);
    }
    this.dimLine(a2, b2, out, Math.abs(pulled) > len(sub(b2, a2)) / 2 ? pulled : undefined);
    this.label(add(mul(add(a2, b2), 0.5), slide), d.text, out, false);
  }

  /** An arc between the two lines with an arrowhead at each end, extension lines out to it, and the value on its middle (beside it when the arc is short). */
  private angle(d: Dimension, project: (p: number[]) => V, out: SVGElement[]) {
    const apex = project(d.points[0]);
    const arc = d.points.slice(1).map(project);
    for (let i = 1; i < arc.length; i++) out.push(line(arc[i - 1], arc[i]));
    out.push(arrow(arc[0], unit(sub(arc[0], arc[1]))), arrow(arc[arc.length - 1], unit(sub(arc[arc.length - 1], arc[arc.length - 2]))));
    for (const [p, q] of d.extend ?? []) {
      const [from, to] = [project(p), project(q)];
      const dir = unit(sub(to, from));
      out.push(line(from, add(to, mul(dir, EXT_OVERSHOOT_PX))));
    }
    const mid = arc[Math.floor(arc.length / 2)];
    let length = 0;
    for (let i = 1; i < arc.length; i++) length += len(sub(arc[i], arc[i - 1]));
    const width = textWidth(d.text);
    const away = unit(sub(mid, apex));
    this.label(length < width + 3 * ARROW_PX ? add(mid, mul(away, width / 2 + ARROW_PX)) : mid, d.text, out, false);
  }

  private leader(d: Dimension, project: (p: number[]) => V, out: SVGElement[]) {
    const a = project(d.points[0]);
    const b = project(d.points[1]);
    // The rim point the leader touches and the way it leaves the feature (away from the centre).
    const rim = b;
    const outDir = unit(sub(b, a));
    if (d.kind === "diameter") {
      // The dimension line spans the hole; the leader leaves from its far end.
      this.dimLine(a, b, out);
    } else {
      out.push(line(a, b), dot(a));
    }
    if (d.kind !== "diameter") out.push(arrow(rim, outDir));
    // Leader: continues past the rim, then a horizontal landing that carries the text.
    const placed = d.labelAt ? project(d.labelAt) : null; // dragged by the user: bend where it was dropped
    const knee = placed ?? add(rim, mul(outDir, LEADER_PX));
    const side = placed ? (placed.x < rim.x ? -1 : 1) : outDir.x < 0 ? -1 : 1;
    const end = add(knee, { x: side * LANDING_PX, y: 0 });
    out.push(line(rim, knee), line(knee, end));
    this.label(add(end, { x: side * (d.text.length * TEXT_PX * 0.275 + 6), y: 0 }), d.text, out, false);
  }

  /** A dimension line with an arrowhead at each end: inside the span, or outside it when the span is too short. */
  private dimLine(a: V, b: V, out: SVGElement[], textAlong?: number) {
    const dir = unit(sub(b, a));
    if (textAlong !== undefined) {
      // `textAlong`: how far from the middle, along the line, the text sits (past one end).
      const mid = mul(add(a, b), 0.5);
      const tail = mul(dir, ARROW_PX + 6);
      // Nothing is drawn between the extension lines: a short tail behind the far arrow, and a line from the near arrow out to the text.
      const toText = add(mid, mul(dir, textAlong));
      if (textAlong > 0) out.push(line(sub(a, tail), a), line(b, toText));
      else out.push(line(toText, a), line(b, add(b, tail)));
      out.push(arrow(a, dir), arrow(b, mul(dir, -1)));
      return;
    }
    if (len(sub(b, a)) < 2.5 * ARROW_PX) {
      const tail = mul(dir, ARROW_PX + 6);
      out.push(line(sub(a, tail), add(b, tail)), arrow(a, dir), arrow(b, mul(dir, -1)));
      return;
    }
    out.push(line(a, b), arrow(a, mul(dir, -1)), arrow(b, dir));
  }

  /** An invisible rectangle over the text: the tooltip, the hover look and the double-click that opens the inline editor. */
  private hitArea(half: V, dim: Dimension, at: V): SVGElement {
    const index = this.current;
    const r = document.createElementNS(NS, "rect");
    r.setAttribute("x", String(-half.x));
    r.setAttribute("y", String(-half.y));
    r.setAttribute("width", String(half.x * 2));
    r.setAttribute("height", String(half.y * 2));
    r.setAttribute("rx", "3");
    r.setAttribute("class", (dim.edit || dim.activate ? "dimhit edit" : "dimhit") + (dim.drag ? " drag" : ""));
    const tip = document.createElementNS(NS, "title");
    tip.textContent = dim.edit || dim.activate ? "Double-click to edit" + (dim.drag ? ", drag to move" : "") : (dim.editNote ?? (dim.drag ? "Drag to move" : ""));
    r.append(tip);
    // The pointer gestures on the text belong to the text: they must not reach the viewport (which would clear the selection).
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup"]) r.addEventListener(type, (e) => e.stopPropagation());
    this.makeDraggable(r, dim);
    if (dim.select) r.addEventListener("click", (e) => dim.select!(e));
    if (dim.menu) {
      r.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        dim.menu!(e);
      });
    }
    if (dim.activate) {
      this.activateOnDoubleTap(r, dim, () => dim.activate!(at));
      r.addEventListener("dblclick", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.activateOnce(() => dim.activate!(at));
      });
    } else if (dim.edit) {
      r.addEventListener("dblclick", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.onActivate?.(index, at);
      });
      r.addEventListener("click", (e) => {
        if (this.dims.length === 1) {
          e.stopPropagation();
          this.onActivate?.(index, at);
        }
      });
    }
    return r;
  }

  /** Dragging the text or a line of a dimension moves it (`dim.drag` gets the pointer); a click without movement stays a click. */
  private makeDraggable(el: SVGElement, dim: Dimension) {
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

  private lastTap: { time: number; x: number; y: number; key: string | number } | null = null;
  private activatedAt = 0;
  private tapDown: { x: number; y: number } | null = null;

  /** Run the editor at most once per double-click, whichever of the two detections (the browser's dblclick, or `activateOnDoubleTap`) sees it first. */
  private activateOnce(run: () => void) {
    if (Date.now() - this.activatedAt < DOUBLE_TAP_MS) return;
    this.activatedAt = Date.now();
    run();
  }

  /** Two quick taps on the same dimension open its editor even when the drawing was rebuilt between them (the browser then sends no dblclick, because the second press lands on a new element). */
  private activateOnDoubleTap(el: SVGElement, dim: Dimension, run: () => void) {
    const key = dim.constraint ?? this.current;
    el.addEventListener("pointerdown", (e) => (this.tapDown = { x: e.clientX, y: e.clientY }));
    el.addEventListener("pointerup", (e) => {
      const down = this.tapDown; // kept on the overlay: the drawing may be rebuilt between the press and the release
      if (e.button !== 0 || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG_START_PX) return; // a drag is not a tap
      const last = this.lastTap;
      const now = Date.now();
      if (last && last.key === key && now - last.time < DOUBLE_TAP_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 2 * DRAG_START_PX) {
        this.lastTap = null;
        this.activateOnce(run);
      } else this.lastTap = { time: now, x: e.clientX, y: e.clientY, key };
    });
  }

  /** Wide invisible copies of a dimension's lines, so double-clicking the leader or dimension line edits it like the text does. */
  private lineHits(d: Dimension, drawn: SVGElement[]): SVGElement[] {
    const at = this.drewLabel;
    // The line across a circle (to its centre or through it) is left out: its hit area would cover the centre and the curve, which stay selectable.
    const lines = drawn.filter((el) => el.tagName === "line");
    return (d.kind === "radius" || d.kind === "diameter" ? lines.slice(1) : lines)
      .map((el) => {
        const hit = el.cloneNode(false) as SVGElement;
        hit.setAttribute("stroke", "rgba(255,138,31,0)");
        hit.setAttribute("stroke-width", "12");
        hit.setAttribute("style", "pointer-events:stroke;cursor:text");
        for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup"]) hit.addEventListener(type, (e) => e.stopPropagation());
        this.makeDraggable(hit, d);
        if (at && d.activate) this.activateOnDoubleTap(hit, d, () => d.activate!(at));
        hit.addEventListener("dblclick", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (at) this.activateOnce(() => d.activate?.(at));
        });
        return hit;
      });
  }

  /** Where the label of the dimension showing a sketch constraint was drawn last frame. */
  labelOfConstraint(id: number): { x: number; y: number } | null {
    for (const [index, p] of this.labelAt) if (this.dims[index]?.constraint === id) return p;
    return null;
  }

  /** Screen positions of the editable dimensions drawn last frame, in dimension order (for Tab to cycle through). */
  editableLabels(): { index: number; x: number; y: number }[] {
    return [...this.labelAt].filter(([i]) => this.dims[i].edit).map(([index, p]) => ({ index, x: p.x, y: p.y }));
  }

  dimension(index: number): Dimension | undefined {
    return this.dims[index];
  }

  /** Cut the dimension's own lines (those already drawn into `out`) around the padded rectangle of its value, so they look broken there; nothing else is hidden. */
  private gapLines(out: SVGElement[], centre: V, half: V) {
    for (let i = out.length - 1; i >= 0; i--) {
      const el = out[i];
      if (el.tagName !== "line") continue;
      const [a, b] = [{ x: Number(el.getAttribute("x1")), y: Number(el.getAttribute("y1")) }, { x: Number(el.getAttribute("x2")), y: Number(el.getAttribute("y2")) }];
      const pieces = gapSegment(a, b, centre, half.x, half.y, 0);
      if (pieces.length === 1 && pieces[0][0] === a && pieces[0][1] === b) continue;
      out.splice(i, 1, ...pieces.map(([from, to]) => line(from, to)));
    }
  }

  private label(at: V, text: string, out: SVGElement[], dotted: boolean) {
    const dim = this.dims[this.current];
    const interactive = !!(dim?.edit || dim?.editNote || dim?.activate || dim?.drag);
    let p = at;
    if (!interactive && this.pointer && len(sub(p, this.pointer)) < CURSOR_CLEAR_PX) {
      p = add(this.pointer, mul(unit(sub(p, this.pointer)), CURSOR_CLEAR_PX));
    }
    const half = { x: textWidth(text) / 2, y: TEXT_PX / 2 + 2 };
    const box = { x0: p.x - half.x, x1: p.x + half.x, y0: p.y - half.y, y1: p.y + half.y };
    if (this.placed.some((q) => overlaps(q, box))) this.clash = true;
    this.pending.push(box);
    // Values are always drawn upright (horizontal on the screen), whatever way their line runs.
    if (dotted && dim?.mark) out.push(dot(at)); // a value's dot would sit under its text
    if (!dim?.mark) this.gapLines(out, p, { x: half.x + GAP_PAD_PX, y: half.y + GAP_PAD_PX }); // the dimension's lines break around its value
    const g = document.createElementNS(NS, "g");
    g.setAttribute("transform", `translate(${p.x},${p.y})`);
    if (interactive) this.drewLabel = p;
    const hidden = this.editing === this.current;
    const t = document.createElementNS(NS, "text");
    t.textContent = hidden ? "" : text;
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("dominant-baseline", "central");
    t.setAttribute("font-size", String(TEXT_PX));
    t.setAttribute("font-family", "system-ui, sans-serif");
    t.setAttribute("style", `fill: ${dim?.selected ? "#ff8a1f" : LINE_COLOR}`);
    t.setAttribute("stroke", HALO_COLOR);
    t.setAttribute("stroke-opacity", HALO_OPACITY);
    t.setAttribute("stroke-width", "3");
    t.setAttribute("paint-order", "stroke");
    g.append(t);
    if (interactive && !hidden) g.append(this.hitArea(half, dim, p));
    out.push(g);
  }
}

const HIT_STYLE = (() => {
  const style = document.createElementNS(NS, "style");
  style.textContent = ".dimhit { fill: rgba(255,138,31,0); stroke: none; pointer-events: all; } .dimhit.edit { cursor: text; } .dimhit.drag { cursor: move; } .dimhit.edit:hover { fill: rgba(255,138,31,0.16); stroke: #ff8a1f; stroke-width: 1; }";
  return style;
})();

interface Box {
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
function textWidth(text: string) {
  return text.length * TEXT_PX * 0.55 + 8;
}

function line(a: V, b: V): SVGElement {
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
function lineHalo(el: SVGElement): SVGElement {
  const h = el.cloneNode(false) as SVGElement;
  h.setAttribute("style", `stroke: ${HALO_COLOR}; pointer-events: none`);
  h.setAttribute("stroke-opacity", HALO_OPACITY);
  h.setAttribute("stroke-width", "3");
  return h;
}

/** Filled arrowhead with its tip at `tip`, pointing along `dir`. */
function arrow(tip: V, dir: V): SVGElement {
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

function dot(at: V): SVGElement {
  const c = document.createElementNS(NS, "circle");
  c.setAttribute("cx", String(at.x));
  c.setAttribute("cy", String(at.y));
  c.setAttribute("r", "3");
  c.setAttribute("style", `fill: ${LINE_COLOR}`);
  c.setAttribute("stroke", HALO_COLOR);
  c.setAttribute("stroke-opacity", HALO_OPACITY);
  c.setAttribute("stroke-width", "2");
  c.setAttribute("paint-order", "stroke");
  return c;
}
