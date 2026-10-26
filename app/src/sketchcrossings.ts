/** Where a line meets an ellipse (or elliptical arc) or a spline: the parameters t along the line (a + t * d, unbounded) that Trim and Extend cut at.
 *  An ellipse is solved exactly; a spline is met along a finely sampled copy of itself. */
import { ellipseAngle, ellipseSweep } from "./sketchellipse.ts";
import { pointOf, polyline } from "./sketchmodel.ts";
import type { SketchData, SketchEntity } from "./sketchmodel.ts";

type P = { u: number; v: number };

export function ellipseCrossings(s: SketchData, e: Extract<SketchEntity, { type: "ellipse" }>, a: P, d: P): number[] {
  const c = pointOf(s, e.center);
  const m = pointOf(s, e.major);
  const major = Math.hypot(m.u - c.u, m.v - c.v) || 1e-9;
  const minor = e.minor1 !== undefined ? Math.hypot(pointOf(s, e.minor1).u - c.u, pointOf(s, e.minor1).v - c.v) : e.minor;
  if (minor < 1e-9) return [];
  const [ux, uy] = [(m.u - c.u) / major, (m.v - c.v) / major];
  const frame = { u: c.u, v: c.v, ux, uy, a: major, b: minor };
  // In the ellipse's own frame, scaled so it is the unit circle, the line is p + t q.
  const local = (x: number, y: number, vector: boolean): [number, number] => {
    const [du, dv] = vector ? [x, y] : [x - c.u, y - c.v];
    return [(du * ux + dv * uy) / major, (-du * uy + dv * ux) / minor];
  };
  const p = local(a.u, a.v, false);
  const q = local(d.u, d.v, true);
  const qa = q[0] * q[0] + q[1] * q[1];
  if (qa < 1e-18) return [];
  const qb = 2 * (p[0] * q[0] + p[1] * q[1]);
  const qc = p[0] * p[0] + p[1] * p[1] - 1;
  const disc = qb * qb - 4 * qa * qc;
  if (disc < 0) return [];
  const root = Math.sqrt(disc);
  const out: number[] = [];
  for (const t of [(-qb - root) / (2 * qa), (-qb + root) / (2 * qa)]) {
    if (e.start !== undefined) {
      // only the part of the ellipse the arc covers
      const from = ellipseAngle(frame, pointOf(s, e.start).u, pointOf(s, e.start).v);
      const sweep = ellipseSweep(from, ellipseAngle(frame, pointOf(s, e.end!).u, pointOf(s, e.end!).v));
      const turn = ((ellipseAngle(frame, a.u + t * d.u, a.v + t * d.v) - from) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      if (turn > sweep + 1e-9) continue;
    }
    out.push(t);
  }
  return out;
}

export function splineCrossings(s: SketchData, e: Extract<SketchEntity, { type: "spline" }>, a: P, d: P): number[] {
  const poly = polyline(s, e, 800);
  const out: number[] = [];
  for (let i = 0; i + 1 < poly.length; i++) {
    const [c, f] = [poly[i], poly[i + 1]];
    const [ex, ey] = [f[0] - c[0], f[1] - c[1]];
    const den = d.u * ey - d.v * ex;
    if (Math.abs(den) < 1e-14) continue;
    const t = ((c[0] - a.u) * ey - (c[1] - a.v) * ex) / den;
    const w = ((c[0] - a.u) * d.v - (c[1] - a.v) * d.u) / den;
    if (w < -1e-9 || w >= 1 - 1e-12) continue; // a sample's far end belongs to the next sample
    if (out.some((x) => Math.abs(x - t) < 1e-9)) continue;
    out.push(t);
  }
  return out;
}
