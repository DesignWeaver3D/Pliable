/** Trim on a circle, an arc, an ellipse or an elliptical arc: the click cuts the curve at every crossing with the lines, circles and arcs
 *  (an ellipse is cut by lines only) that meet it, turns the piece under the click into construction geometry, and a second click deletes it
 *  (that second click is handled with the lines' in sketchtrim.ts). A whole circle or ellipse needs two crossings; it becomes arcs that share the
 *  cut points. Each cut point is held on the crossing curve. No DOM. */
import { ellipseCrossings } from "./sketchcrossings.ts";
import { ellipseAngle, ellipsePoint, ellipseSweep } from "./sketchellipse.ts";
import { angleOf, geoOf, lineCircleParams, meet, mod, onCurve, roundOf, sub, TWO_PI } from "./sketchintersect.ts";
import type { Pt } from "./sketchintersect.ts";
import { frameOf } from "./sketchsplitellipse.ts";
import { nextId, pointOf } from "./sketchdata.ts";
import type { SketchConstraint, SketchData, SketchEntity } from "./sketchdata.ts";

type Curve = Extract<SketchEntity, { type: "circle" | "arc" | "ellipse" }>;
export interface TrimCurveResult {
  sketch: SketchData;
  candidates: Set<number>;
}

/** A curve by angle: the angle of a point near it, the point at an angle, where it starts (null for a whole circle) and how far it runs. */
interface Param {
  angleOf(p: Pt): number;
  pointAt(t: number): Pt;
  from: number | null;
  sweep: number;
}

function paramOf(s: SketchData, e: Curve): Param | null {
  if (e.type === "ellipse") {
    if (e.minor1 === undefined) return null; // an old ellipse without axis end points cannot be cut
    const f = frameOf(s, e);
    const angle = (p: Pt) => ellipseAngle(f, p[0], p[1]);
    const from = e.start === undefined ? null : angle([pointOf(s, e.start).u, pointOf(s, e.start).v]);
    const sweep = from === null ? TWO_PI : ellipseSweep(from, angle([pointOf(s, e.end!).u, pointOf(s, e.end!).v]));
    return { angleOf: angle, pointAt: (t) => ellipsePoint(f, t), from, sweep };
  }
  const { c, r } = roundOf(s, e);
  const from = e.type === "circle" ? null : angleOf(c, [pointOf(s, e.start).u, pointOf(s, e.start).v]);
  const sweep = e.type === "circle" ? TWO_PI : mod(angleOf(c, [pointOf(s, e.end).u, pointOf(s, e.end).v]) - from!) || TWO_PI;
  return { angleOf: (p) => angleOf(c, p), pointAt: (t) => [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)], from, sweep };
}

/** Where other curves cross this one: points with the id of the crossing curve. Lines, circles and arcs cross a circle or an arc; lines cross an ellipse. */
function hitsOn(s: SketchData, e: Curve): { p: Pt; entity: number }[] {
  const out: { p: Pt; entity: number }[] = [];
  for (const o of s.entities) {
    if (o.id === e.id) continue;
    if (o.type === "line") {
      const a: Pt = [pointOf(s, o.a).u, pointOf(s, o.a).v];
      const d = sub([pointOf(s, o.b).u, pointOf(s, o.b).v], a);
      const ts = e.type === "ellipse" ? ellipseCrossings(s, e, { u: a[0], v: a[1] }, { u: d[0], v: d[1] }) : lineCircleParams(a, d, roundOf(s, e).c, roundOf(s, e).r);
      for (const t of ts) if (t >= -1e-9 && t <= 1 + 1e-9) out.push({ p: [a[0] + t * d[0], a[1] + t * d[1]], entity: o.id });
    } else if ((o.type === "circle" || o.type === "arc") && e.type !== "ellipse") {
      for (const p of meet(geoOf(s, e), geoOf(s, o))) if (onCurve(s, o, p)) out.push({ p, entity: o.id });
    }
  }
  return out;
}

/** The first click of Trim on a curve that is not a line: cut it and mark the piece under the click. A message when it cannot be cut. */
export function trimCurve(s: SketchData, id: number, u: number, v: number, candidates: ReadonlySet<number>, hold: boolean): TrimCurveResult | string | null {
  const e = s.entities.find((x) => x.id === id);
  if (!e || (e.type !== "circle" && e.type !== "arc" && e.type !== "ellipse") || e.reference) return null;
  const param = paramOf(s, e);
  if (!param) return "An ellipse without axis end points (from an old file) cannot be trimmed";
  const whole = param.from === null;
  const along = (p: Pt) => mod(param.angleOf(p) - (param.from ?? 0));
  const eps = 1e-7;
  // The crossings along the curve, nearest the start first; an arc ignores the ones at its ends and past them.
  const hits = hitsOn(s, e)
    .map((h) => ({ ...h, at: along(h.p) }))
    .filter((h) => whole || (h.at > eps && h.at < param.sweep - eps))
    .sort((x, y) => x.at - y.at);
  const cuts: { at: number; entities: number[] }[] = [];
  for (const h of hits) {
    const last = cuts[cuts.length - 1];
    if (last && h.at - last.at < eps) last.entities.push(h.entity);
    else cuts.push({ at: h.at, entities: [h.entity] });
  }
  if (whole && cuts.length < 2) return "A whole circle or ellipse needs two other curves crossing it to be trimmed";
  const click = along([u, v]);
  const mark = (sketch: SketchData, piece: number): TrimCurveResult => ({
    sketch: { ...sketch, entities: sketch.entities.map((x) => (x.id === piece ? { ...x, construction: true } : x)) },
    candidates: new Set([...candidates, piece]),
  });
  if (!cuts.length) return mark(s, id); // crossed by nothing: the whole arc is the piece
  // New cut points, then the boundary points of each piece.
  let next = nextId(s);
  const points = [...s.points];
  const cutIds = cuts.map((c) => {
    const [pu, pv] = param.pointAt((param.from ?? 0) + c.at);
    points.push({ id: next, u: pu, v: pv });
    return next++;
  });
  const startId = e.type === "circle" ? null : e.start!;
  const endId = e.type === "circle" ? null : e.end!;
  const bounds = whole ? [...cutIds, cutIds[0]] : [startId!, ...cutIds, endId!];
  const spots = whole ? [...cuts.map((c) => c.at), cuts[0].at + TWO_PI] : [0, ...cuts.map((c) => c.at), param.sweep];
  const pieceAt = (x: number) => {
    let k = spots.slice(0, -1).reduce((best, spot, i) => (spot <= x + 1e-12 ? i : best), whole ? spots.length - 2 : 0);
    if (whole && x < spots[0]) k = spots.length - 2; // before the first cut: the piece that wraps round
    return k;
  };
  const ids = bounds.slice(0, -1).map((_, k) => (k === 0 ? id : next++));
  const pieces = ids.map((pid, k): SketchEntity => (e.type === "circle" ? { id: pid, type: "arc", center: e.center, start: bounds[k], end: bounds[k + 1], ...(e.construction ? { construction: true } : {}) } : { ...e, id: pid, start: bounds[k], end: bounds[k + 1] }));
  const entities = s.entities.flatMap((x) => (x.id === id ? pieces : [x]));
  // Points that lay on the whole curve stay on the piece they are in; every other constraint stays with the first piece.
  const constraints: SketchConstraint[] = s.constraints.map((c) => {
    if (c.type !== "point_on" || c.entity !== id || c.point === undefined) return c;
    const p = pointOf(s, c.point);
    return { ...c, entity: ids[pieceAt(along([p.u, p.v]))] };
  });
  if (hold) for (const [i, cut] of cuts.entries()) for (const entity of new Set(cut.entities)) constraints.push({ id: next++, type: "point_on", point: cutIds[i], entity, auto: true });
  return mark({ ...s, points, entities, constraints }, ids[pieceAt(click)]);
}
