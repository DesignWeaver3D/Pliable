/** Which way a constraint mark leaves its point so that it lies outside the profile where it can, and the other ways to try when that place is taken. No DOM or WebGL. */
import { entityOf, entityPoints, pointOf, type SketchData, type SketchConstraint } from "./sketchmodel.ts";
import { radiusOf } from "./sketchconstraints.ts";

type UV = [number, number];
const unit = (a: UV): UV => {
  const n = Math.hypot(a[0], a[1]);
  return n < 1e-9 ? [0, 0] : [a[0] / n, a[1] / n];
};

/** The angle of a direction in the sketch plane, and the angles to try after it: a quarter turn each way before half a turn, so a mark that cannot go outside goes beside. */
export const fan = (preferred: UV): number[] => {
  const base = Math.atan2(preferred[1], preferred[0]);
  return [0, 1, -1, 2, -2, 3, -3, 4].map((k) => base + (k * Math.PI) / 4);
};

/** Away from the geometry joined at the point (the bisector of the curves leaving it), or from the middle of the sketch when that says nothing. */
function awayFromNeighbours(s: SketchData, pointId: number): UV {
  const p = pointOf(s, pointId);
  let sum: UV = [0, 0];
  for (const e of s.entities) {
    if (!entityPoints(e).includes(pointId)) continue;
    const others: UV[] = e.type === "line" ? [pointOf(s, e.a === pointId ? e.b : e.a)].map((q) => [q.u, q.v] as UV) : e.type === "arc" || e.type === "circle" ? [[pointOf(s, e.center).u, pointOf(s, e.center).v] as UV] : [];
    for (const q of others) {
      const d = unit([q[0] - p.u, q[1] - p.v]);
      sum = [sum[0] + d[0], sum[1] + d[1]];
    }
  }
  const away = unit([-sum[0], -sum[1]]);
  if (away[0] !== 0 || away[1] !== 0) return away;
  const n = s.points.length || 1;
  const middle: UV = [s.points.reduce((a, q) => a + q.u, 0) / n, s.points.reduce((a, q) => a + q.v, 0) / n];
  const out = unit([p.u - middle[0], p.v - middle[1]]);
  return out[0] !== 0 || out[1] !== 0 ? out : unit([1, 1]);
}

/** The preferred direction for a Coincident mark (a point on a curve, or points joined): outside the circle or arc, off the side of a line away from the sketch's middle, or away from the curves meeting at the point. */
export function coincidentDirection(s: SketchData, c: SketchConstraint, at: UV): UV {
  const ids = [...(c.points ?? []), ...(c.point !== undefined ? [c.point] : [])];
  const e = c.type === "point_on" ? entityOf(s, c.entity) : undefined;
  if (e && (e.type === "circle" || e.type === "arc")) {
    const centre = pointOf(s, e.center);
    const out = unit([at[0] - centre.u, at[1] - centre.v]);
    if (radiusOf(s, e) > 1e-9 && (out[0] !== 0 || out[1] !== 0)) return out;
  }
  if (e && e.type === "line") {
    const [a, b] = [pointOf(s, e.a), pointOf(s, e.b)];
    const side = unit([-(b.v - a.v), b.u - a.u]);
    const n = s.points.length || 1;
    const middle: UV = [s.points.reduce((t, q) => t + q.u, 0) / n, s.points.reduce((t, q) => t + q.v, 0) / n];
    const toward = (at[0] - middle[0]) * side[0] + (at[1] - middle[1]) * side[1];
    if (side[0] !== 0 || side[1] !== 0) return toward >= 0 ? side : [-side[0], -side[1]];
  }
  return ids.length ? awayFromNeighbours(s, ids[0]) : unit([1, 1]);
}

/** A direction turned by `angle` radians (positive is a left turn, looking along it). */
export const turn = (d: UV, angle: number): UV => [d[0] * Math.cos(angle) - d[1] * Math.sin(angle), d[0] * Math.sin(angle) + d[1] * Math.cos(angle)];

/** Where a Coincident mark is drawn from: the point itself (a point on a curve), or the middle of the points joined. */
export function coincidentSpot(s: SketchData, c: SketchConstraint): UV | null {
  const ids = [...(c.points ?? []), ...(c.point !== undefined ? [c.point] : [])];
  if (!ids.length || (c.type !== "point_on" && c.type !== "coincident")) return null;
  const at = ids.map((id) => pointOf(s, id));
  return [at.reduce((a, q) => a + q.u, 0) / at.length, at.reduce((a, q) => a + q.v, 0) / at.length];
}

/** Whether two places in the sketch are the same vertex. */
export const sameSpot = (a: UV, b: UV): boolean => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;

/** Where a vertex has both a Coincident and a Tangent mark they sit side by side on either side of the one outside direction: Coincident on the left, Tangent on the right. */
export const PAIRED_TURN = Math.PI / 4;
