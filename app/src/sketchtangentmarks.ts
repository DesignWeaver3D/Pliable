/** Where a tangent constraint's curves touch, and which way is out of the profile there, for its mark. No DOM or WebGL. */
import { pointOf, entityOf, type SketchData, type SketchConstraint } from "./sketchmodel.ts";
import { radiusOf } from "./sketchconstraints.ts";

type UV = [number, number];
export interface TangentSpot {
  u: number;
  v: number;
  /** A unit direction in the sketch plane pointing away from the curves' inside. */
  out: UV;
}

const unit = (a: UV): UV => {
  const n = Math.hypot(a[0], a[1]) || 1;
  return [a[0] / n, a[1] / n];
};

/** The touching point of the two curves of a tangent constraint (none when either is not a line, circle or arc). */
export function tangentSpots(s: SketchData, c: SketchConstraint): TangentSpot[] {
  const [a, b] = (c.entities ?? []).map((id) => entityOf(s, id));
  if (!a || !b) return [];
  const round = (e: typeof a) => (e.type === "circle" || e.type === "arc" ? { centre: pointOf(s, e.center), r: radiusOf(s, e) } : null);
  const ra = round(a);
  const rb = round(b);
  if (ra && rb) {
    // The touching point lies on the line of centers: out from the first center for outside contact, along the other side for inside contact.
    const along = unit([rb.centre.u - ra.centre.u, rb.centre.v - ra.centre.v]);
    const toward: UV = [ra.centre.u + along[0] * ra.r, ra.centre.v + along[1] * ra.r];
    const away: UV = [ra.centre.u - along[0] * ra.r, ra.centre.v - along[1] * ra.r];
    const gap = (p: UV) => Math.abs(Math.hypot(p[0] - rb.centre.u, p[1] - rb.centre.v) - rb.r);
    const at = gap(toward) <= gap(away) ? toward : away;
    return [{ u: at[0], v: at[1], out: [-along[1], along[0]] }]; // beside the contact, off both curves' insides
  }
  const line = a.type === "line" ? a : b.type === "line" ? b : null;
  const curve = ra ?? rb;
  if (!line || !curve) return [];
  const [p, q] = [pointOf(s, line.a), pointOf(s, line.b)];
  const d = unit([q.u - p.u, q.v - p.v]);
  const t = (curve.centre.u - p.u) * d[0] + (curve.centre.v - p.v) * d[1];
  const foot: UV = [p.u + d[0] * t, p.v + d[1] * t]; // the point of the line nearest the round curve's center
  return [{ u: foot[0], v: foot[1], out: unit([foot[0] - curve.centre.u, foot[1] - curve.centre.v]) }];
}
