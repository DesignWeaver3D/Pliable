/** The model's origin and principal axes as seen from a sketch plane, and the sketch's own axes. No DOM. */
import { frame, toPlane } from "./sketchdata.ts";
import type { PlaneData, SketchPoint } from "./sketchdata.ts";

/**
 * Fixed points for the model's origin as seen from a sketch plane: the origin projected onto the plane, and
 * where each principal axis meets the plane. Positions already taken by `existing` are left out.
 */
export function originPoints(plane: PlaneData, existing: SketchPoint[]): { u: number; v: number }[] {
  const f = frame(plane);
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const candidates: number[][] = [f.n.map((c) => dot(f.origin, f.n) * c)];
  for (const d of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
    const along = dot(f.n, d);
    if (Math.abs(along) > 1e-9) candidates.push(d.map((c) => (dot(f.n, f.origin) / along) * c));
  }
  const found: { u: number; v: number }[] = [];
  for (const c of candidates) {
    const [u, v] = toPlane(plane, c);
    if (Math.abs(u) > 1e6 || Math.abs(v) > 1e6) continue;
    if ([...existing, ...found].some((p) => Math.hypot(p.u - u, p.v - v) < 1e-6)) continue;
    found.push({ u, v });
  }
  return found;
}

/**
 * The principal axes projected onto a sketch plane, as lines in sketch coordinates (a point and a unit
 * direction), with the axis index (0 x, 1 y, 2 z). An axis square to the plane projects to a single point
 * (see `originPoints`) and gives no line. An axis off the plane is shown where it appears, not where it is.
 */
export function axisLines(plane: PlaneData): { u: number; v: number; du: number; dv: number; axis: number }[] {
  const f = frame(plane);
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const [u, v] = toPlane(plane, f.n.map((c) => dot(f.origin, f.n) * c)); // the origin dropped onto the plane
  const lines = [];
  for (const [axis, d] of [[1, 0, 0], [0, 1, 0], [0, 0, 1]].entries()) {
    const [du, dv] = [dot(d, f.x), dot(d, f.y)];
    const length = Math.hypot(du, dv);
    if (length < 1e-6) continue;
    lines.push({ u, v, du: du / length, dv: dv / length, axis });
  }
  return lines;
}

/**
 * The sketch's own axes: through the plane origin (the center of the face the sketch is made on) along its u and v
 * directions. `axis` is the model axis (0 x, 1 y, 2 z) each runs closest to, which gives its color.
 */
export function sketchAxes(plane: PlaneData): { u: number; v: number; du: number; dv: number; axis: number }[] {
  const f = frame(plane);
  const nearest = (d: number[]) => {
    const a = d.map(Math.abs);
    return a.indexOf(Math.max(...a));
  };
  return [
    { u: 0, v: 0, du: 1, dv: 0, axis: nearest(f.x) },
    { u: 0, v: 0, du: 0, dv: 1, axis: nearest(f.y) },
  ];
}

