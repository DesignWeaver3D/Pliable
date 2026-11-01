/** The shape of sketch curves as points: the outline of each curve, its length, how far a point is from it and where it is nearest, and the tangent snaps that depend on a curve's outline. */
import { positiveSweep, TWO_PI } from "./anglemath.ts";
import { ellipseAngle, ellipseArcPoints, ellipseSweep } from "./sketchellipse.ts";
import { projectOnSegment } from "./segmentmath.ts";
import { arcSamples } from "./sketchshapes.ts";
import { pointOf } from "./sketchdata.ts";
import type { SketchData, SketchEntity } from "./sketchdata.ts";

/** A smooth (Catmull-Rom) curve through the spline's points, sampled for drawing and picking. */
function splinePolyline(s: SketchData, e: Extract<SketchEntity, { type: "spline" }>, segments: number): [number, number][] {
  const pts = e.points.map((id) => pointOf(s, id));
  const n = pts.length;
  if (n < 2) return [];
  const at = (i: number) => (e.closed && n > 2 ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const spans = e.closed && n > 2 ? n : n - 1;
  const per = Math.max(4, Math.ceil(segments / 4));
  const out: [number, number][] = [];
  for (let i = 0; i < spans; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    for (let k = 0; k < per; k++) {
      const t = k / per;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
      out.push([f(p0.u, p1.u, p2.u, p3.u), f(p0.v, p1.v, p2.v, p3.v)]);
    }
  }
  const last = at(spans);
  out.push([last.u, last.v]);
  return out;
}

/** How long an entity's outline is, for ordering stacked curves. */
export function entityLength(s: SketchData, e: SketchEntity): number {
  const line = polyline(s, e);
  let total = 0;
  for (let i = 1; i < line.length; i++) total += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  return total;
}

/** Polyline of an entity in sketch coordinates (circles and arcs sampled), for drawing and picking. */
export function polyline(s: SketchData, e: SketchEntity, segments = 48): [number, number][] {
  if (e.type === "line") return [[pointOf(s, e.a).u, pointOf(s, e.a).v], [pointOf(s, e.b).u, pointOf(s, e.b).v]];
  if (e.type === "spline") return splinePolyline(s, e, segments);
  const c = pointOf(s, e.center);
  if (e.type === "ellipse") {
    const m = pointOf(s, e.major);
    const a = Math.hypot(m.u - c.u, m.v - c.v) || 1e-9;
    const [ux, uy] = [(m.u - c.u) / a, (m.v - c.v) / a];
    const b = e.minor1 !== undefined ? Math.hypot(pointOf(s, e.minor1).u - c.u, pointOf(s, e.minor1).v - c.v) : e.minor; // the minor end sets the short radius while it is dragged
    const f = { u: c.u, v: c.v, ux, uy, a, b };
    if (e.start !== undefined) {
      const from = ellipseAngle(f, pointOf(s, e.start).u, pointOf(s, e.start).v);
      return ellipseArcPoints(f, from, ellipseSweep(from, ellipseAngle(f, pointOf(s, e.end!).u, pointOf(s, e.end!).v)), segments);
    }
    return ellipseArcPoints(f, 0, 2 * Math.PI, segments);
  }
  if (e.type === "circle") {
    return arcSamples(c, e.radius, 0, TWO_PI, segments);
  }
  const start = pointOf(s, e.start);
  const end = pointOf(s, e.end);
  const r = Math.hypot(start.u - c.u, start.v - c.v);
  const a0 = Math.atan2(start.v - c.v, start.u - c.u);
  const sweep = positiveSweep(Math.atan2(end.v - c.v, end.u - c.u) - a0); // arcs run counterclockwise
  return arcSamples(c, r, a0, sweep, segments);
}

/** Distance from (u, v) to an entity's polyline. */
export function distanceTo(s: SketchData, e: SketchEntity, u: number, v: number): number {
  const line = polyline(s, e);
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    best = Math.min(best, projectOnSegment(u, v, line[i][0], line[i][1], line[i + 1][0], line[i + 1][1]).dist);
  }
  return best;
}

/** The point of entity `e` nearest to (u, v), or null for a degenerate entity. */
export function closestOn(s: SketchData, e: SketchEntity, u: number, v: number): [number, number] | null {
  const line = polyline(s, e);
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const h = projectOnSegment(u, v, line[i][0], line[i][1], line[i + 1][0], line[i + 1][1]);
    const p: [number, number] = [h.x, h.y];
    const d = h.dist;
    if (d < bestD) (bestD = d), (best = p);
  }
  return best;
}

/**
 * Radius at which a circle about `centre` would touch an existing curve, if that is within `reach` of the
 * radius the cursor asks for. Returns the touching entity and the point on the cursor's ray at that radius.
 */
export function tangentRadius(s: SketchData, centre: { u: number; v: number }, u: number, v: number, reach: number): { u: number; v: number; entity: number } | null {
  const ask = Math.hypot(u - centre.u, v - centre.v);
  if (ask < 1e-9) return null;
  let best: { radius: number; entity: number; gap: number } | null = null;
  const consider = (radius: number, entity: number, touch: [number, number], tol = 1e-6) => {
    const gap = Math.abs(radius - ask);
    if (radius > 1e-6 && gap < reach && (!best || gap < best.gap) && distanceTo(s, s.entities.find((x) => x.id === entity)!, touch[0], touch[1]) < tol) best = { radius, entity, gap };
  };
  for (const e of s.entities) {
    if (e.type === "line") {
      const a = pointOf(s, e.a);
      const b = pointOf(s, e.b);
      const dx = b.u - a.u;
      const dy = b.v - a.v;
      const t = ((centre.u - a.u) * dx + (centre.v - a.v) * dy) / (dx * dx + dy * dy || 1);
      const foot: [number, number] = [a.u + t * dx, a.v + t * dy];
      if (t >= 0 && t <= 1) consider(Math.hypot(foot[0] - centre.u, foot[1] - centre.v), e.id, foot);
    } else if (e.type === "circle" || e.type === "arc") {
      const c = pointOf(s, e.center);
      const r = e.type === "circle" ? e.radius : Math.hypot(pointOf(s, e.start).u - c.u, pointOf(s, e.start).v - c.v);
      const d = Math.hypot(c.u - centre.u, c.v - centre.v);
      if (d < 1e-9) continue;
      const dir = [(c.u - centre.u) / d, (c.v - centre.v) / d];
      // |d - r| touches the near side of the other circle, d + r the far side.
      consider(Math.abs(d - r), e.id, [c.u - dir[0] * r, c.v - dir[1] * r], 0.01 * (1 + r));
      consider(d + r, e.id, [c.u + dir[0] * r, c.v + dir[1] * r], 0.01 * (1 + r));
    }
  }
  const hit = best as { radius: number; entity: number } | null;
  if (!hit) return null;
  return { u: centre.u + ((u - centre.u) / ask) * hit.radius, v: centre.v + ((v - centre.v) / ask) * hit.radius, entity: hit.entity };
}

/**
 * Point on a circle or arc where a line from `from` would just touch it, if that is within `reach` of the
 * cursor (u, v). Used to snap the end of a line being drawn so it leaves tangent to the curve.
 */
export function tangentFrom(s: SketchData, from: { u: number; v: number }, u: number, v: number, reach: number): { u: number; v: number; entity: number } | null {
  let best: { u: number; v: number; entity: number; gap: number } | null = null;
  for (const e of s.entities) {
    if (e.type !== "circle" && e.type !== "arc") continue;
    const c = pointOf(s, e.center);
    const r = e.type === "circle" ? e.radius : Math.hypot(pointOf(s, e.start).u - c.u, pointOf(s, e.start).v - c.v);
    const d = Math.hypot(from.u - c.u, from.v - c.v);
    if (d <= r * 1.0001) continue;
    const base = Math.atan2(from.v - c.v, from.u - c.u);
    const spread = Math.acos(r / d);
    for (const angle of [base + spread, base - spread]) {
      const t: [number, number] = [c.u + r * Math.cos(angle), c.v + r * Math.sin(angle)];
      const gap = Math.hypot(t[0] - u, t[1] - v);
      if (gap < reach && (!best || gap < best.gap) && distanceTo(s, e, t[0], t[1]) < 0.01 * (1 + r)) best = { u: t[0], v: t[1], entity: e.id, gap };
    }
  }
  return best;
}
