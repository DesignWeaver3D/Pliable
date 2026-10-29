/** The arc tools that take numbers from the sketch card: the center Arc's start angle and sweep, and the radius of "Arc by ends and radius"
 *  (two end points, a radius, and the pointer choosing which of the four arcs of that radius is meant). No DOM. */
import * as M from "./sketchmodel.ts";
import type { BuilderContext } from "./sketchbuilders.ts";
import type { Snap } from "./sketch.ts";
import type { UV } from "./sketchshapes.ts";

/** Numbers kept in the sketch card; null leaves the choice to the pointer. Angles are degrees counterclockwise from the sketch's horizontal axis. */
export interface ArcOptions {
  startAngle: number | null;
  /** Counterclockwise degrees, more than 0 and at most 360. */
  sweep: number | null;
  radius: number;
}
export const defaultArcOptions = (): ArcOptions => ({ startAngle: null, sweep: null, radius: 10 });

const turn = (centre: UV, from: UV, radians: number): UV => {
  const r = Math.hypot(from.u - centre.u, from.v - centre.v);
  const a = Math.atan2(from.v - centre.v, from.u - centre.u) + radians;
  return { u: centre.u + r * Math.cos(a), v: centre.v + r * Math.sin(a) };
};

/** The center arc's click, with a typed start angle or sweep applied: the second click keeps its distance but takes the start angle, the
 *  third is placed at the sweep from the start. `chainLength` is how many points are placed. */
export function arcClick(chain: UV[], snap: Snap, options: ArcOptions): Snap {
  if (chain.length === 1 && options.startAngle !== null) {
    const c = chain[0];
    const r = Math.hypot(snap.u - c.u, snap.v - c.v);
    const a = (options.startAngle * Math.PI) / 180;
    return { u: c.u + r * Math.cos(a), v: c.v + r * Math.sin(a) };
  }
  if (chain.length === 2 && options.sweep !== null) return { ...turn(chain[0], chain[1], (options.sweep * Math.PI) / 180) };
  return snap;
}

/** The two ends of the arc of radius `radius` between `s` and `e`, the one nearest the pointer among the four (two centers, near or far side). */
export interface RadiusArc {
  centre: UV;
  /** Counterclockwise from `from` to `to`. */
  from: UV;
  to: UV;
}
export function arcByRadius(s: UV, e: UV, radius: number, pointer: UV): RadiusArc | null {
  const [cu, cv] = [e.u - s.u, e.v - s.v];
  const chord = Math.hypot(cu, cv);
  const half = chord / 2;
  if (chord < 1e-9 || radius < half - 1e-9) return null;
  const mid = { u: (s.u + e.u) / 2, v: (s.v + e.v) / 2 };
  const n = { u: -cv / chord, v: cu / chord };
  const d = Math.sqrt(Math.max(0, radius * radius - half * half));
  const side = (p: UV) => (p.u - mid.u) * n.u + (p.v - mid.v) * n.v;
  const sigma = side(pointer) < 0 ? -1 : 1;
  let best: RadiusArc | null = null;
  let bestGap = Infinity;
  for (const k of [1, -1]) {
    const centre = { u: mid.u + n.u * d * k, v: mid.v + n.v * d * k };
    const gap = Math.abs(Math.hypot(pointer.u - centre.u, pointer.v - centre.v) - radius);
    // the counterclockwise arc from s to e bulges to one side of the chord; the other arc of that circle (e to s) bulges to the other
    const a0 = Math.atan2(s.v - centre.v, s.u - centre.u);
    const sweep = (Math.atan2(e.v - centre.v, e.u - centre.u) - a0 + 4 * Math.PI) % (2 * Math.PI);
    const middle = { u: centre.u + radius * Math.cos(a0 + sweep / 2), v: centre.v + radius * Math.sin(a0 + sweep / 2) };
    const arc = side(middle) * sigma > 0 ? { centre, from: s, to: e } : { centre, from: e, to: s };
    if (gap < bestGap) [best, bestGap] = [arc, gap];
  }
  return best;
}

export function radiusArcPoints(arc: RadiusArc, count = 48): [number, number][] {
  const r = Math.hypot(arc.from.u - arc.centre.u, arc.from.v - arc.centre.v);
  const a0 = Math.atan2(arc.from.v - arc.centre.v, arc.from.u - arc.centre.u);
  const sweep = (Math.atan2(arc.to.v - arc.centre.v, arc.to.u - arc.centre.u) - a0 + 4 * Math.PI) % (2 * Math.PI);
  return Array.from({ length: count + 1 }, (_, i) => [arc.centre.u + r * Math.cos(a0 + (sweep * i) / count), arc.centre.v + r * Math.sin(a0 + (sweep * i) / count)] as [number, number]);
}

/** The arc between the first two clicks with the card's radius; `side` is the third click. The radius is kept as a dimension. */
export function addArcRadius(ctx: BuilderContext, start: Snap, end: Snap, side: Snap, radius: number) {
  if (!(radius > 0)) return ctx.status("Type a radius above zero in the sketch card", true);
  const arc = arcByRadius(start, end, radius, side);
  if (!arc) return ctx.status("The radius is smaller than half the distance between the two end points, so no arc fits", true);
  ctx.pushUndo();
  const [a, b] = [ctx.pointFor(start), ctx.pointFor(end)];
  const centre = ctx.pointFor({ u: arc.centre.u, v: arc.centre.v } as Snap);
  const id = M.nextId(ctx.s);
  const first = arc.from === start;
  ctx.s.entities.push({ id, type: "arc", center: centre, start: first ? a : b, end: first ? b : a });
  ctx.s.constraints.push({ id: M.nextId(ctx.s), type: "radius", entity: id, value: radius });
  ctx.resolve();
}
