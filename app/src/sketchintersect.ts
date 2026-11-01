/** Where sketch curves meet, in one place for every tool that needs it: Trim, Extend and Split cut a line where other curves cross it
 *  (`crossingsWith`), and Fillet and Chamfer find where two lines, arcs or circles meet (`meet`) and whether a hit lies on the curve itself
 *  (`onCurve`). Lines, circles and arcs share the primitives below; ellipses and splines are met by `sketchcrossings.ts`. */
import { pointOf } from "./sketchdata.ts";
import type { SketchData, SketchEntity } from "./sketchdata.ts";
import { unit2, type Pt } from "./vec.ts";
import { TWO_PI, turnCounterclockwise } from "./anglemath.ts";
import { ellipseCrossings, splineCrossings } from "./sketchcrossings.ts";

export type { Pt };
type Line = Extract<SketchEntity, { type: "line" }>;
export type Round = Extract<SketchEntity, { type: "arc" | "circle" }>;
export type Curve = Line | Round;
export { TWO_PI };

export const isCurve = (e: SketchEntity | undefined): e is Curve => !!e && (e.type === "line" || e.type === "arc" || e.type === "circle");

export const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
export const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
export const len = (a: Pt) => Math.hypot(a[0], a[1]);
export const unit = unit2;
export const at = (s: SketchData, id: number): Pt => [pointOf(s, id).u, pointOf(s, id).v];
export const mod = turnCounterclockwise;
export const angleOf = (c: Pt, p: Pt) => Math.atan2(p[1] - c[1], p[0] - c[0]);

/** The center and radius of an arc or circle. */
export function roundOf(s: SketchData, e: Round): { c: Pt; r: number } {
  const c = at(s, e.center);
  return { c, r: e.type === "circle" ? e.radius : len(sub(at(s, e.start), c)) };
}

/** Whether the point (taken to lie on the arc's circle) is within the arc's counterclockwise sweep. */
export function inSweep(s: SketchData, arc: Extract<SketchEntity, { type: "arc" }>, p: Pt): boolean {
  const c = at(s, arc.center);
  const a0 = angleOf(c, at(s, arc.start));
  return mod(angleOf(c, p) - a0) <= (mod(angleOf(c, at(s, arc.end)) - a0) || TWO_PI) + 1e-9;
}

/** Whether the point (taken to lie on the curve's circle or line) is on the curve itself, not just its extension. */
export function onCurve(s: SketchData, e: Curve, p: Pt): boolean {
  if (e.type === "circle") return true;
  if (e.type === "arc") return inSweep(s, e, p);
  const a = at(s, e.a);
  const d = sub(at(s, e.b), a);
  const t = dot(sub(p, a), d) / (dot(d, d) || 1);
  return t >= -1e-9 && t <= 1 + 1e-9;
}

// Primitives: an infinite line is a point and a direction, a circle a center and radius -----------------

export type Geo = { line: true; p: Pt; d: Pt } | { line: false; c: Pt; r: number };

export function geoOf(s: SketchData, e: Curve): Geo {
  if (e.type === "line") {
    const a = at(s, e.a);
    return { line: true, p: a, d: unit(sub(at(s, e.b), a)) };
  }
  const { c, r } = roundOf(s, e);
  return { line: false, c, r };
}

/** Where the line p + t d meets the line q + w e: both parameters, or null when they are parallel. */
export function lineLineParams(p: Pt, d: Pt, q: Pt, e: Pt): { t: number; w: number } | null {
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-12) return null;
  const f = sub(q, p);
  return { t: (f[0] * e[1] - f[1] * e[0]) / den, w: (f[0] * d[1] - f[1] * d[0]) / den };
}

/** The parameters t where the line p + t d meets the circle (one for a touch, none for a miss). */
export function lineCircleParams(p: Pt, d: Pt, c: Pt, r: number): number[] {
  const qa = dot(d, d);
  if (qa < 1e-12) return [];
  const f = sub(p, c);
  const b = dot(f, d) / qa;
  const disc = b * b - (dot(f, f) - r * r) / qa;
  if (disc < -1e-12) return [];
  const root = Math.sqrt(Math.max(0, disc));
  return root < 1e-9 ? [-b] : [-b - root, -b + root];
}

function lineLine(a: Geo & { line: true }, b: Geo & { line: true }): Pt[] {
  const hit = lineLineParams(a.p, a.d, b.p, b.d);
  return hit ? [[a.p[0] + hit.t * a.d[0], a.p[1] + hit.t * a.d[1]]] : [];
}
function lineCircle(l: Geo & { line: true }, k: Geo & { line: false }): Pt[] {
  return lineCircleParams(l.p, l.d, k.c, k.r).map((t): Pt => [l.p[0] + t * l.d[0], l.p[1] + t * l.d[1]]);
}
function circleCircle(a: Geo & { line: false }, b: Geo & { line: false }): Pt[] {
  const d = len(sub(b.c, a.c));
  if (d < 1e-9 || d > a.r + b.r + 1e-9 || d < Math.abs(a.r - b.r) - 1e-9) return [];
  const x = (d * d + a.r * a.r - b.r * b.r) / (2 * d);
  const h = Math.sqrt(Math.max(0, a.r * a.r - x * x));
  const u = unit(sub(b.c, a.c));
  const m: Pt = [a.c[0] + u[0] * x, a.c[1] + u[1] * x];
  return h < 1e-9 ? [m] : [[m[0] - u[1] * h, m[1] + u[0] * h], [m[0] + u[1] * h, m[1] - u[0] * h]];
}

/** Where two infinite lines or circles meet. */
export function meet(a: Geo, b: Geo): Pt[] {
  if (a.line && b.line) return lineLine(a, b);
  if (a.line && !b.line) return lineCircle(a, b);
  if (!a.line && b.line) return lineCircle(b, a);
  return circleCircle(a as Geo & { line: false }, b as Geo & { line: false });
}

// Where other curves cross a line ---------------------------------------------------------------------

/** Parameters t along line `e` (0 at its start, 1 at its end, unbounded) where it meets other lines, circles, arcs, ellipses and splines. */
export function crossings(s: SketchData, e: Line): number[] {
  return crossingsWith(s, e).map((x) => x.t);
}

/** The same crossings, each with the id of the curve that crosses the line there. */
export function crossingsWith(s: SketchData, e: Line): { t: number; entity: number }[] {
  const a = pointOf(s, e.a);
  const b = pointOf(s, e.b);
  const [p, d]: [Pt, Pt] = [[a.u, a.v], [b.u - a.u, b.v - a.v]];
  const found: { t: number; entity: number }[] = [];
  for (const o of s.entities) {
    if (o.id === e.id) continue;
    const add = (...values: number[]) => found.push(...values.map((t) => ({ t, entity: o.id })));
    if (o.type === "line") {
      const hit = lineLineParams(p, d, at(s, o.a), sub(at(s, o.b), at(s, o.a)));
      if (hit && hit.w >= -1e-9 && hit.w <= 1 + 1e-9) add(hit.t); // only where the other line is, not its extension
    } else if (o.type === "ellipse") {
      add(...ellipseCrossings(s, o, a, { u: d[0], v: d[1] }));
    } else if (o.type === "spline") {
      add(...splineCrossings(s, o, a, { u: d[0], v: d[1] }));
    } else if (o.type === "circle" || o.type === "arc") {
      const { c, r } = roundOf(s, o);
      add(...lineCircleParams(p, d, c, r).filter((t) => o.type !== "arc" || inSweep(s, o, [p[0] + t * d[0], p[1] + t * d[1]]))); // only the part of the circle the arc covers
    }
  }
  return found.sort((x, y) => x.t - y.t);
}
