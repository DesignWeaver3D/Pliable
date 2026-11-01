/** Where a new radius or diameter leader goes on a circle or an arc, kept off the leaders already on circles and arcs with the same center
 *  (so concentric dimensions do not lie on each other). A circle starts at 45° in the quadrant the pointer was in, an arc at the middle of
 *  its curve; each then takes the free slot nearest that start (see the slot lists below). No DOM. */
import { pointOf, type SketchData } from "./sketchdata.ts";
import { arcLeaderWay, arcSpan } from "./sketchannotate.ts";

const DEG = Math.PI / 180;
/** Two leaders closer in angle than this lie on top of each other. */
const SAME = 3 * DEG;
/** Angles in a circle's quadrant (from its horizontal side) in the order they are filled: 45°, then the 15° steps nearest 45°, then the 7.5°
 *  gaps nearest 45°. None is nearer than 15° to horizontal or vertical. A pair is ordered by the side the pointer was on. */
const SLOTS = [[45], [60, 30], [75, 15], [52.5, 37.5], [67.5, 22.5]];
/** How far inside the ends of an arc its leaders stay, so they do not sit on the end points. */
const ARC_MARGIN = 7.5 * DEG;

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
      const way = arcLeaderWay(s, e, k.place ?? null, k.angle).way;
      a = Math.atan2(way[1], way[0]);
    } else a = k.place ? Math.atan2(k.place[1] - o.v, k.place[0] - o.u) : (k.angle ?? Math.PI / 4);
    out.push(a);
    if (k.type === "diameter") out.push(a + Math.PI);
  }
  return out;
}

/** The first candidate direction no taken one lies on (a diameter also needs its far end free); undefined when every one is taken. */
function firstFree(candidates: Iterable<number>, type: "radius" | "diameter", taken: number[]): number | undefined {
  for (const a of candidates) {
    if ((type === "diameter" ? [a, a + Math.PI] : [a]).every((r) => taken.every((t) => apart(r, t) > SAME))) return a;
  }
  return undefined;
}

/** A circle's candidates: the pointer's quadrant first, then the two beside it, then the opposite one, each in SLOTS order. */
function* circleCandidates(sx: number, sy: number, pointer: number): Generator<number> {
  for (const [qx, qy] of [[sx, sy], [-sx, sy], [sx, -sy], [-sx, -sy]]) {
    for (const pair of SLOTS) {
      for (const local of [...pair].sort((p, q) => Math.abs(p - pointer) - Math.abs(q - pointer))) yield Math.atan2(qy * Math.sin(local * DEG), qx * Math.cos(local * DEG));
    }
  }
}

/** An arc's candidates: its middle, then the 15° steps either side of it that stay inside the curve (nearest first), then the 7.5° gaps, then
 *  on past each end in 7.5° steps, alternating sides. `side` (1: toward the end of the arc, -1: toward its start) goes first in each pair. */
function* arcCandidates(a0: number, sweep: number, side: number): Generator<number> {
  const mid = a0 + sweep / 2;
  const room = sweep / 2 - ARC_MARGIN + 1e-9;
  yield mid;
  for (let off = 15 * DEG; off <= room; off += 15 * DEG) yield* [mid + side * off, mid - side * off];
  for (let off = 7.5 * DEG; off <= room; off += 15 * DEG) yield* [mid + side * off, mid - side * off];
  for (let i = 1; i <= 24; i++) {
    const beyond = [a0 + sweep + i * 7.5 * DEG, a0 - i * 7.5 * DEG]; // past the end, before the start
    yield* side > 0 ? beyond : beyond.reverse();
  }
}

/** The direction (radians, sketch coordinates) for a new `type` dimension on circle or arc `id`, made with the pointer at `at` (none: a
 *  circle gets the up-and-right quadrant, an arc goes toward its end first); undefined for any other entity. */
export function leaderAngle(s: SketchData, id: number | undefined, type: "radius" | "diameter", at?: { u: number; v: number } | null): number | undefined {
  const e = id === undefined ? undefined : s.entities.find((x) => x.id === id);
  if (e?.type !== "circle" && e?.type !== "arc") return undefined;
  const taken = takenDirections(s, pointOf(s, e.center));
  if (e.type === "circle") {
    const c = pointOf(s, e.center);
    const [du, dv] = at ? [at.u - c.u, at.v - c.v] : [1, 1];
    const [sx, sy] = [du >= 0 ? 1 : -1, dv >= 0 ? 1 : -1];
    return firstFree(circleCandidates(sx, sy, Math.atan2(Math.abs(dv), Math.abs(du)) / DEG), type, taken) ?? Math.atan2(sy, sx); // every slot taken: lie on the first one
  }
  const { c, a0, sweep } = arcSpan(s, e);
  const side = at ? Math.sign(Math.sin(Math.atan2(at.v - c.v, at.u - c.u) - (a0 + sweep / 2))) || 1 : 1;
  return firstFree(arcCandidates(a0, sweep, side), type, taken) ?? a0 + sweep / 2;
}
