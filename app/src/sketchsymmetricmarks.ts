/** The marks of a Symmetric constraint. Picture the virtual line L through the two mirrored points (P and Q) and the center C (the center point, or
 *  for a mirror line the spot on it halfway between the points). Every icon's centerline is square to L, so its triangles face along L.
 *  - P and Q: a mark straight out along L past each point, away from C, the triangle facing C bright (Q's is P's turned half a turn).
 *  - C: a mark beside C and off L, on the side most upward and to the right when L is vertical; for a mirror line that spot is on the line, so it
 *    is turned a quarter turn about C, onto L, off the line.
 *  Nothing is moved around its point to dodge another mark: a crowded one drops out. No DOM. */
import type { Dimension } from "./dimensions.ts";
import { pointOf, toWorld, type SketchConstraint, type SketchData } from "./sketchdata.ts";

type UV = [number, number];

/** The marks, or null when the points cannot define L (fewer than two, or on top of each other): the caller falls back to the generic places. */
export function symmetricMarks(s: SketchData, c: SketchConstraint, text: string): Dimension[] | null {
  const ids = (c.points ?? []).slice(0, 2);
  if (ids.length !== 2 || !ids.every((id) => s.points.some((q) => q.id === id))) return null;
  const [p, q] = ids.map((id) => pointOf(s, id));
  const length = Math.hypot(q.u - p.u, q.v - p.v);
  if (length < 1e-9) return null;
  const centre = c.type === "symmetric_point" && c.point !== undefined ? pointOf(s, c.point) : { u: (p.u + q.u) / 2, v: (p.v + q.v) / 2 };
  const along: UV = [(q.u - p.u) / length, (q.v - p.v) / length];
  // The side of L for the center mark: the normal pointing up and to the right (to the right when L is vertical).
  let normal: UV = [-along[1], along[0]];
  if (normal[0] + normal[1] < -1e-9 || (Math.abs(normal[0] + normal[1]) <= 1e-9 && normal[0] < 0)) normal = [-normal[0], -normal[1]];
  const onLine = c.type === "symmetric"; // the center is on the mirror line, so the mark turns onto L
  const world = (at: { u: number; v: number }) => toWorld(s.plane, at.u, at.v);
  const vector = (at: { u: number; v: number }, d: UV) => world({ u: at.u + d[0], v: at.v + d[1] }).map((x, k) => x - world(at)[k]);
  const awayFrom = (at: { u: number; v: number }): UV => {
    const d: UV = [at.u - centre.u, at.v - centre.v];
    const size = Math.hypot(d[0], d[1]);
    return size > 1e-9 ? [d[0] / size, d[1] / size] : at === p ? [-along[0], -along[1]] : along;
  };
  const common = { kind: "tag" as const, text, mark: true, constraint: c.id };
  const end = (at: { u: number; v: number }): Dimension => {
    const out = awayFrom(at);
    return { ...common, points: [world(at)], icon: "Symmetric end", outward: vector(at, out), iconFacing: vector(at, [-out[0], -out[1]]) };
  };
  const mid: UV = onLine ? [-normal[1], normal[0]] : normal;
  return [end(p), end(q), { ...common, points: [world(centre)], icon: "Symmetric center", outward: vector(centre, mid), iconAlong: vector(centre, normal) }];
}
