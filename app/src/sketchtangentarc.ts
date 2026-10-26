/** The Tangent arc tool: an arc that starts at the end of a line or arc and leaves it tangentially, ending at the second click.
 *  The first click is an end point of a line or arc, or the curve itself (its nearer end is taken). No DOM. */
import * as M from "./sketchmodel.ts";
import type { BuilderContext } from "./sketchbuilders.ts";
import type { Snap } from "./sketch.ts";
import type { UV } from "./sketchshapes.ts";

type Curve = Extract<M.SketchEntity, { type: "line" | "arc" }>;

const endsOf = (e: Curve) => (e.type === "line" ? [e.a, e.b] : [e.start, e.end]);

/** The unit direction that continues `curve` beyond its end at point `pointId`, or null when the point is not an end of it. */
export function continuation(s: M.SketchData, curve: Curve, pointId: number): UV | null {
  const p = M.pointOf(s, pointId);
  let d: UV;
  if (curve.type === "line") {
    if (pointId !== curve.a && pointId !== curve.b) return null;
    const o = M.pointOf(s, pointId === curve.b ? curve.a : curve.b);
    d = { u: p.u - o.u, v: p.v - o.v };
  } else {
    if (pointId !== curve.start && pointId !== curve.end) return null;
    const c = M.pointOf(s, curve.center);
    const sign = pointId === curve.end ? 1 : -1; // arcs run counterclockwise: beyond the end goes on counterclockwise, beyond the start clockwise
    d = { u: -(p.v - c.v) * sign, v: (p.u - c.u) * sign };
  }
  const length = Math.hypot(d.u, d.v);
  return length < 1e-12 ? null : { u: d.u / length, v: d.v / length };
}

/** What the first click names: the start point with the curve it continues (as `tangent`), or a message saying why it cannot start an arc. */
export function tangentStart(s: M.SketchData, snap: Snap): Snap | string {
  const curves = s.entities.filter((e): e is Curve => (e.type === "line" || e.type === "arc"));
  const fail = "Click the end of a line or arc, or the line or arc itself, to start the tangent arc";
  if (snap.id !== undefined) {
    const here = curves.filter((e) => endsOf(e).includes(snap.id!));
    if (!here.length) return fail;
    if (here.length > 1) return "Several curves end at that point; click the line or arc itself near its end";
    return { u: snap.u, v: snap.v, id: snap.id, tangent: here[0].id };
  }
  const curve = snap.on ? curves.find((e) => e.id === snap.on!.entity) : undefined;
  if (!curve) return fail;
  const away = (pid: number) => Math.hypot(M.pointOf(s, pid).u - snap.u, M.pointOf(s, pid).v - snap.v);
  const end = endsOf(curve).sort((a, b) => away(a) - away(b))[0];
  const p = M.pointOf(s, end);
  return { u: p.u, v: p.v, id: end, tangent: curve.id };
}

export interface TangentArc {
  centre: UV;
  /** The arc as stored (counterclockwise from `from` to `to`). */
  from: UV;
  to: UV;
  /** True when the arc runs from the start click to the end click counterclockwise. */
  counterclockwise: boolean;
}

/** The arc from `start`, leaving in direction `dir`, to `end`; null when `end` lies on the tangent line (no arc, only a straight line, fits). */
export function tangentArcTo(start: UV, dir: UV, end: UV): TangentArc | null {
  const [wu, wv] = [end.u - start.u, end.v - start.v];
  const side = -dir.v * wu + dir.u * wv; // how far end is to the left of the direction
  const reach = Math.hypot(wu, wv);
  if (reach < 1e-9 || Math.abs(side) < 1e-9 * reach) return null;
  const t = (wu * wu + wv * wv) / (2 * side);
  const centre = { u: start.u - dir.v * t, v: start.v + dir.u * t };
  const counterclockwise = side > 0;
  return { centre, from: counterclockwise ? start : end, to: counterclockwise ? end : start, counterclockwise };
}

/** Points along the arc for the rubber band. */
export function tangentArcPoints(arc: TangentArc, count = 48): [number, number][] {
  const r = Math.hypot(arc.from.u - arc.centre.u, arc.from.v - arc.centre.v);
  const a0 = Math.atan2(arc.from.v - arc.centre.v, arc.from.u - arc.centre.u);
  const sweep = (Math.atan2(arc.to.v - arc.centre.v, arc.to.u - arc.centre.u) - a0 + 4 * Math.PI) % (2 * Math.PI);
  return Array.from({ length: count + 1 }, (_, i) => [arc.centre.u + r * Math.cos(a0 + (sweep * i) / count), arc.centre.v + r * Math.sin(a0 + (sweep * i) / count)] as [number, number]);
}

/** The arc for the start click (as `tangentStart` returned it) and an end position, or null. */
export function tangentArcFor(s: M.SketchData, start: Snap, end: UV): TangentArc | null {
  const curve = s.entities.find((e) => e.id === start.tangent);
  if (!curve || (curve.type !== "line" && curve.type !== "arc") || start.id === undefined) return null;
  const dir = continuation(s, curve, start.id);
  return dir ? tangentArcTo(M.pointOf(s, start.id), dir, end) : null;
}

export function addTangentArc(ctx: BuilderContext, start: Snap, end: Snap) {
  const arc = tangentArcFor(ctx.s, start, end);
  if (!arc) return ctx.status("The end is straight ahead of the line, so no arc fits; use the Line tool, or click a point to one side", true);
  if (end.id !== undefined && end.id === start.id) return;
  ctx.pushUndo();
  const s = ctx.pointFor(start);
  const e = ctx.pointFor(end);
  const centre = ctx.pointFor({ u: arc.centre.u, v: arc.centre.v } as Snap);
  const id = M.nextId(ctx.s);
  ctx.s.entities.push({ id, type: "arc", center: centre, start: arc.counterclockwise ? s : e, end: arc.counterclockwise ? e : s });
  if (start.tangent !== undefined) ctx.addConstraintRaw({ type: "tangent", entities: [id, start.tangent] }, "always"); // the arc leaves the curve smoothly
  ctx.resolve();
}
