/** Drawing-style dimension leaders over the viewport, from the `dimensions` in the core's `measure` reply. */
import * as THREE from "three";

export interface Dimension {
  kind: "linear" | "diameter" | "radius" | "tag";
  text: string;
  points: number[][];
  offsetDirection?: number[];
}

const DIM_OFFSET_PX = 36; // distance of a linear dimension line from the measured points
const EXT_OVERSHOOT_PX = 6; // extension lines run this far past the dimension line
const EXT_GAP_PX = 3; // and start this far from the measured points
const ARROW_PX = 9;
const LEADER_PX = 34; // a leader runs this far beyond the feature before its landing
const LANDING_PX = 14; // the short horizontal landing the text sits at the end of
const TEXT_PX = 13;
const CURSOR_CLEAR_PX = 28; // text moves away when the pointer is closer than this
const COLOR = "#ff8a1f";
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

  private placed: Box[] = []; // text boxes of the dimensions drawn so far this frame
  private pending: Box[] = [];
  private clash = false;
  private drawn = ""; // what the SVG currently shows (camera, size, pointer, dimensions); unchanged means skip the redraw

  set(dims: Dimension[]) {
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
    const state = [...cam.matrixWorld.elements, ...(cam as THREE.PerspectiveCamera).projectionMatrix.elements, rect.width, rect.height, this.pointer?.x, this.pointer?.y].join(",");
    if (state === this.drawn) return; // nothing moved: rebuilding the SVG every frame made it flicker
    this.drawn = state;
    const project = (p: number[]): V => {
      const n = new THREE.Vector3(p[0], p[1], p[2]).project(this.camera());
      return { x: ((n.x + 1) / 2) * rect.width, y: ((1 - n.y) / 2) * rect.height };
    };
    const parts: SVGElement[] = [];
    this.placed = [];
    for (const d of this.dims) {
      // A dimension whose text would land on one already drawn is left out; the measurement panel still lists it.
      const mine: SVGElement[] = [];
      this.pending = [];
      this.clash = false;
      try {
        if (d.kind === "linear") this.linear(d, project, mine);
        else if (d.kind === "tag") this.label(project(d.points[0]), d.text, mine, true);
        else this.leader(d, project, mine);
      } catch (e) {
        console.error("A dimension could not be drawn and was skipped:", d, e);
        continue;
      }
      if (this.clash) continue;
      parts.push(...mine);
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
    const off = mul(side, DIM_OFFSET_PX);
    const a2 = add(a, off);
    const b2 = add(b, off);
    for (const [p, q] of [
      [a, a2],
      [b, b2],
    ] as const) {
      const dir = unit(sub(q, p));
      out.push(line(add(p, mul(dir, EXT_GAP_PX)), add(q, mul(dir, EXT_OVERSHOOT_PX))));
    }
    this.dimLine(a2, b2, out);
    this.label(mul(add(a2, b2), 0.5), d.text, out, false, angleOf(along));
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
    const knee = add(rim, mul(outDir, LEADER_PX));
    const side = outDir.x < 0 ? -1 : 1;
    const end = add(knee, { x: side * LANDING_PX, y: 0 });
    out.push(line(rim, knee), line(knee, end));
    this.label(add(end, { x: side * (d.text.length * TEXT_PX * 0.275 + 6), y: 0 }), d.text, out, false);
  }

  /** A dimension line with an arrowhead at each end: inside the span, or outside it when the span is too short. */
  private dimLine(a: V, b: V, out: SVGElement[]) {
    const dir = unit(sub(b, a));
    if (len(sub(b, a)) < 2.5 * ARROW_PX) {
      const tail = mul(dir, ARROW_PX + 6);
      out.push(line(sub(a, tail), add(b, tail)), arrow(a, dir), arrow(b, mul(dir, -1)));
      return;
    }
    out.push(line(a, b), arrow(a, mul(dir, -1)), arrow(b, dir));
  }

  private label(at: V, text: string, out: SVGElement[], dotted: boolean, angle = 0) {
    let p = at;
    if (this.pointer && len(sub(p, this.pointer)) < CURSOR_CLEAR_PX) {
      p = add(this.pointer, mul(unit(sub(p, this.pointer)), CURSOR_CLEAR_PX));
    }
    const half = { x: (text.length * TEXT_PX * 0.55 + 8) / 2, y: TEXT_PX / 2 + 2 };
    const box = { x0: p.x - half.x, x1: p.x + half.x, y0: p.y - half.y, y1: p.y + half.y };
    if (this.placed.some((q) => overlaps(q, box))) this.clash = true;
    this.pending.push(box);
    // Keep text upright.
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    if (dotted) out.push(dot(at));
    const g = document.createElementNS(NS, "g");
    g.setAttribute("transform", `translate(${p.x},${p.y}) rotate(${angle})`);
    const t = document.createElementNS(NS, "text");
    t.textContent = text;
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("dominant-baseline", "central");
    t.setAttribute("font-size", String(TEXT_PX));
    t.setAttribute("font-family", "system-ui, sans-serif");
    t.setAttribute("fill", COLOR);
    t.setAttribute("stroke", "#1b1d22");
    t.setAttribute("stroke-width", "4");
    t.setAttribute("paint-order", "stroke");
    g.append(t);
    out.push(g);
  }
}

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

function angleOf(d: V) {
  return (Math.atan2(d.y, d.x) * 180) / Math.PI;
}

function line(a: V, b: V): SVGElement {
  const l = document.createElementNS(NS, "line");
  l.setAttribute("x1", String(a.x));
  l.setAttribute("y1", String(a.y));
  l.setAttribute("x2", String(b.x));
  l.setAttribute("y2", String(b.y));
  l.setAttribute("stroke", COLOR);
  l.setAttribute("stroke-width", "1.5");
  return l;
}

/** Filled arrowhead with its tip at `tip`, pointing along `dir`. */
function arrow(tip: V, dir: V): SVGElement {
  const back = sub(tip, mul(dir, ARROW_PX));
  const n = { x: -dir.y, y: dir.x };
  const p = document.createElementNS(NS, "polygon");
  const pts = [tip, add(back, mul(n, ARROW_PX / 3)), sub(back, mul(n, ARROW_PX / 3))];
  p.setAttribute("points", pts.map((q) => `${q.x},${q.y}`).join(" "));
  p.setAttribute("fill", COLOR);
  return p;
}

function dot(at: V): SVGElement {
  const c = document.createElementNS(NS, "circle");
  c.setAttribute("cx", String(at.x));
  c.setAttribute("cy", String(at.y));
  c.setAttribute("r", "3");
  c.setAttribute("fill", COLOR);
  return c;
}
