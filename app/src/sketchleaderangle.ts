/** Where a new circle radius or diameter leader goes: 45° in the quadrant the pointer was in, or, when another dimension on a circle
 *  or arc with the same center already uses that direction, the nearest free slot (so concentric dimensions do not lie on top of each
 *  other). No DOM. */
import { pointOf, type SketchData } from "./sketchdata.ts";
import { arcLeaderWay } from "./sketchannotate.ts";

const DEG = Math.PI / 180;
/** Two leaders closer in angle than this lie on top of each other. */
const SAME = 3 * DEG;
/** Angles in a quadrant (from its horizontal side) in the order they are filled: 45°, then the 15° steps nearest 45°, then the 7.5° gaps
 *  nearest 45°. None is nearer than 15° to horizontal or vertical. A pair is ordered by the side the pointer was on. */
const SLOTS = [[45], [60, 30], [75, 15], [52.5, 37.5], [67.5, 22.5]];

const apart = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/** The directions (radians, sketch coordinates) taken by the radius and diameter dimensions of circles and arcs centered where `center` is;
 *  a diameter takes both ends of its line. */
function takenDirections(s: SketchData, center: { u: number; v: number }): number[] {
  const out: number[] = [];
  for (const k of s.constraints) {
    if (k.type !== "radius" && k.type !== "diameter") continue;
    const e = s.entities.find((x) => x.id === k.entity);
    if (!e || (e.type !== "circle" && e.type !== "arc")) continue;
    const o = pointOf(s, e.center);
    if (Math.hypot(o.u - center.u, o.v - center.v) > 1e-6) continue;
    let a: number;
    if (e.type === "arc") {
      const way = arcLeaderWay(s, e, k.place ?? null).way;
      a = Math.atan2(way[1], way[0]);
    } else a = k.place ? Math.atan2(k.place[1] - o.v, k.place[0] - o.u) : (k.angle ?? Math.PI / 4);
    out.push(a);
    if (k.type === "diameter") out.push(a + Math.PI);
  }
  return out;
}

/** The direction (radians, sketch coordinates) for a new `type` dimension on circle `id`, made with the pointer at `at`; undefined for anything but a circle. */
export function leaderAngle(s: SketchData, id: number | undefined, type: "radius" | "diameter", at: { u: number; v: number } | null | undefined): number | undefined {
  const circle = id === undefined ? undefined : s.entities.find((e) => e.id === id);
  if (!at || circle?.type !== "circle") return undefined;
  const c = pointOf(s, circle.center);
  const [du, dv] = [at.u - c.u, at.v - c.v];
  const [sx, sy] = [du >= 0 ? 1 : -1, dv >= 0 ? 1 : -1];
  const pointer = Math.atan2(Math.abs(dv), Math.abs(du)) / DEG;
  const taken = takenDirections(s, c);
  const free = (a: number) => (type === "diameter" ? [a, a + Math.PI] : [a]).every((r) => taken.every((t) => apart(r, t) > SAME));
  // The pointer's quadrant first, then the two beside it, then the opposite one.
  for (const [qx, qy] of [[sx, sy], [-sx, sy], [sx, -sy], [-sx, -sy]]) {
    for (const pair of SLOTS) {
      for (const local of [...pair].sort((p, q) => Math.abs(p - pointer) - Math.abs(q - pointer))) {
        const a = Math.atan2(qy * Math.sin(local * DEG), qx * Math.cos(local * DEG));
        if (free(a)) return a;
      }
    }
  }
  return Math.atan2(sy, sx); // every slot is taken: lie on the first one
}
