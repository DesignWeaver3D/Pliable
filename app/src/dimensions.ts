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
    private readonly camera: THREE.Camera,
  ) {
    this.svg.setAttribute("style", "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:hidden");
    container.append(this.svg);
    window.addEventListener("pointermove", (e) => {
      const r = this.svg.getBoundingClientRect();
      this.pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    });
  }

  set(dims: Dimension[]) {
    this.dims = dims;
    if (dims.length === 0) this.svg.replaceChildren();
  }

  /** Redraw for the current camera; called every frame, cheap when there is nothing to show. */
  draw() {
    if (this.dims.length === 0) return;
    const rect = this.svg.getBoundingClientRect();
    const project = (p: number[]): V => {
      const n = new THREE.Vector3(p[0], p[1], p[2]).project(this.camera);
      return { x: ((n.x + 1) / 2) * rect.width, y: ((1 - n.y) / 2) * rect.height };
    };
    const parts: SVGElement[] = [];
    for (const d of this.dims) {
      if (d.kind === "linear") this.linear(d, project, parts);
      else if (d.kind === "tag") this.label(project(d.points[0]), d.text, parts, true);
      else this.leader(d, project, parts);
    }
    this.svg.replaceChildren(...parts);
  }

  private linear(d: Dimension, project: (p: number[]) => V, out: SVGElement[]) {
    const a = project(d.points[0]);
    const b = project(d.points[1]);
    const along = unit(sub(b, a));
    if (!d.offsetDirection) {
      // A distance between two items: the dimension line joins the points directly.
      this.dimLine(a, b, out);
      this.label(mul(add(a, b), 0.5), d.text, out, false, angleOf(along));
      return;
    }
    const o = d.offsetDirection;
    let side = sub(project(d.points[0].map((c, k) => c + o[k])), a);
    side = len(side) < 1e-3 ? { x: -along.y, y: along.x } : unit(side);
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
    if (d.kind === "diameter") {
      this.dimLine(a, b, out);
    } else {
      out.push(line(a, b), arrow(b, unit(sub(b, a))), dot(a));
    }
    this.label(mul(add(a, b), 0.5), d.text, out, false);
  }

  /** A dimension line with an arrowhead at each end pointing outward. */
  private dimLine(a: V, b: V, out: SVGElement[]) {
    const dir = unit(sub(b, a));
    out.push(line(a, b), arrow(a, mul(dir, -1)), arrow(b, dir));
  }

  private label(at: V, text: string, out: SVGElement[], dotted: boolean, angle = 0) {
    let p = at;
    if (this.pointer && len(sub(p, this.pointer)) < CURSOR_CLEAR_PX) {
      p = add(this.pointer, mul(unit(sub(p, this.pointer)), CURSOR_CLEAR_PX));
    }
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
