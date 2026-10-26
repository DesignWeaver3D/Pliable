/** Fillet and Chamfer where a corner involves an arc or a circle: line and arc, arc and arc, and either with a circle. Two lines stay in `roundCorner`
 *  (sketchmodel.ts). The curves may meet at a shared end point (a corner), cross, or not touch at all (fillet only). The fillet circle is the one of the
 *  typed radius, tangent to both curves, whose centre is nearest the pointer; each curve is cut or stretched to its tangent point. */
import { dropOrphans, entityPoints, nextId, pointOf } from "./sketchmodel.ts";
import type { SketchConstraint, SketchData, SketchEntity, SketchPoint } from "./sketchmodel.ts";

type Pt = [number, number];
type Line = Extract<SketchEntity, { type: "line" }>;
type Round = Extract<SketchEntity, { type: "arc" | "circle" }>;
type Curve = Line | Round;
const EPS = 1e-9;
const TWO_PI = 2 * Math.PI;

const isCurve = (e: SketchEntity | undefined): e is Curve => !!e && (e.type === "line" || e.type === "arc" || e.type === "circle");
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
const len = (a: Pt) => Math.hypot(a[0], a[1]);
const unit = (a: Pt): Pt => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};
const at = (s: SketchData, id: number): Pt => [pointOf(s, id).u, pointOf(s, id).v];
const mod = (x: number) => ((x % TWO_PI) + TWO_PI) % TWO_PI;

/** The centre and radius of an arc or circle. */
function roundOf(s: SketchData, e: Round): { c: Pt; r: number } {
  const c = at(s, e.center);
  return { c, r: e.type === "circle" ? e.radius : len(sub(at(s, e.start), c)) };
}
/** Counterclockwise unit tangent of a round curve at the point t on it. */
const ccwTangent = (c: Pt, t: Pt): Pt => unit([-(t[1] - c[1]), t[0] - c[0]]);
const angleOf = (c: Pt, p: Pt) => Math.atan2(p[1] - c[1], p[0] - c[0]);
function inSweep(s: SketchData, arc: Extract<SketchEntity, { type: "arc" }>, p: Pt): boolean {
  const c = at(s, arc.center);
  const a0 = angleOf(c, at(s, arc.start));
  return mod(angleOf(c, p) - a0) <= (mod(angleOf(c, at(s, arc.end)) - a0) || TWO_PI) + 1e-9;
}
/** Whether the point (taken to lie on the curve's circle or line) is on the curve itself, not just its extension. */
function onCurve(s: SketchData, e: Curve, p: Pt): boolean {
  if (e.type === "circle") return true;
  if (e.type === "arc") return inSweep(s, e, p);
  const a = at(s, e.a);
  const d = sub(at(s, e.b), a);
  const t = dot(sub(p, a), d) / (dot(d, d) || 1);
  return t >= -1e-9 && t <= 1 + 1e-9;
}

// Intersections ---------------------------------------------------------------------------------------

type Geo = { line: true; p: Pt; d: Pt } | { line: false; c: Pt; r: number };
function lineLine(a: Geo & { line: true }, b: Geo & { line: true }): Pt[] {
  const den = a.d[0] * b.d[1] - a.d[1] * b.d[0];
  if (Math.abs(den) < 1e-12) return [];
  const w = sub(b.p, a.p);
  const t = (w[0] * b.d[1] - w[1] * b.d[0]) / den;
  return [[a.p[0] + t * a.d[0], a.p[1] + t * a.d[1]]];
}
function lineCircle(l: Geo & { line: true }, k: Geo & { line: false }): Pt[] {
  const f = sub(l.p, k.c);
  const b = dot(f, l.d);
  const disc = b * b - (dot(f, f) - k.r * k.r);
  if (disc < -1e-12) return [];
  const root = Math.sqrt(Math.max(0, disc));
  const ts = root < 1e-9 ? [-b] : [-b - root, -b + root];
  return ts.map((t): Pt => [l.p[0] + t * l.d[0], l.p[1] + t * l.d[1]]);
}
function circleCircle(a: Geo & { line: false }, b: Geo & { line: false }): Pt[] {
  const d = len(sub(b.c, a.c));
  if (d < 1e-9 || d > a.r + b.r + 1e-9 || d < Math.abs(a.r - b.r) - 1e-9) return [];
  const x = (d * d + a.r * a.r - b.r * b.r) / (2 * d);
  const h = Math.sqrt(Math.max(0, a.r * a.r - x * x));
  const u = unit(sub(b.c, a.c));
  const m: Pt = [a.c[0] + u[0] * x, a.c[1] + u[1] * x];
  return h < 1e-9 ? [m] : [[m[0] - u[1] * h, m[1] + u[0] * h], [m[0] + u[1] * h, m[1] - u[0] * h]];
}
function meet(a: Geo, b: Geo): Pt[] {
  if (a.line && b.line) return lineLine(a, b);
  if (a.line && !b.line) return lineCircle(a, b);
  if (!a.line && b.line) return lineCircle(b, a);
  return circleCircle(a as Geo & { line: false }, b as Geo & { line: false });
}
function geoOf(s: SketchData, e: Curve): Geo {
  if (e.type === "line") {
    const a = at(s, e.a);
    return { line: true, p: a, d: unit(sub(at(s, e.b), a)) };
  }
  const { c, r } = roundOf(s, e);
  return { line: false, c, r };
}
/** The curves parallel to `g` at distance r on either side: the centre of a fillet circle of radius r lies on one from each curve. */
function offsets(g: Geo, r: number): Geo[] {
  if (g.line) {
    const n: Pt = [-g.d[1] * r, g.d[0] * r];
    return [{ line: true, p: [g.p[0] + n[0], g.p[1] + n[1]], d: g.d }, { line: true, p: [g.p[0] - n[0], g.p[1] - n[1]], d: g.d }];
  }
  const out: Geo[] = [{ line: false, c: g.c, r: g.r + r }];
  if (Math.abs(g.r - r) > EPS) out.push({ line: false, c: g.c, r: Math.abs(g.r - r) });
  return out;
}
/** Where a circle of radius r centred at p touches the curve g. */
function touch(g: Geo, p: Pt, r: number): Pt {
  if (g.line) {
    const k = dot(sub(p, g.p), g.d);
    return [g.p[0] + g.d[0] * k, g.p[1] + g.d[1] * k];
  }
  const dir = unit(sub(p, g.c));
  const dist = len(sub(p, g.c));
  const sign = r > g.r && Math.abs(dist - (r - g.r)) < 1e-6 * Math.max(1, r) ? -1 : 1; // the fillet circle holds the curve inside it
  return [g.c[0] + dir[0] * g.r * sign, g.c[1] + dir[1] * g.r * sign];
}

// Cutting a curve to a tangent or chamfer point --------------------------------------------------------

/** How one curve is cut back: `replace` is the end point that moves to the new point; `keep` the end that stays; `ccw` whether the kept part runs
 *  counterclockwise from the new point (arcs). A full circle has no end points: it becomes an arc up to `cross`, or stays whole without one. */
interface Cut {
  entity: Curve;
  replace?: number;
  keep?: number;
  ccw?: boolean;
  cross?: Pt;
}

/** Plan the cut of `e` at the point t on it; the part kept runs from t in direction k (a vector along the curve at t). `other` is what a full
 *  circle is cut against; `corner` (a shared end point) must be the end that is cut away. Null if the curve cannot be cut there. */
function planCut(s: SketchData, e: Curve, t: Pt, k: Pt, other: Curve | null, corner: number | null): Cut | null {
  if (e.type === "line") {
    const proj = (id: number) => dot(sub(at(s, id), t), k);
    const [keep, replace] = proj(e.a) >= proj(e.b) ? [e.a, e.b] : [e.b, e.a];
    if (proj(keep) < 1e-6) return null;
    if (corner !== null && (replace !== corner || proj(replace) > -1e-6)) return null;
    return { entity: e, replace, keep };
  }
  const { c, r } = roundOf(s, e);
  const ccw = dot(k, ccwTangent(c, t)) > 0;
  const sigma = ccw ? 1 : -1;
  const travel = (p: Pt) => mod(sigma * (angleOf(c, p) - angleOf(c, t)));
  if (e.type === "circle") {
    if (corner !== null || !other) return { entity: e, ccw };
    // The part cut away runs from t against k to the nearest crossing with the other curve.
    const og = geoOf(s, other);
    const hits = meet({ line: false, c, r }, og).filter((p) => onCurve(s, other, p) && mod(-sigma * (angleOf(c, p) - angleOf(c, t))) > 1e-6);
    hits.sort((p, q) => mod(-sigma * (angleOf(c, p) - angleOf(c, t))) - mod(-sigma * (angleOf(c, q) - angleOf(c, t))));
    return hits.length ? { entity: e, ccw, cross: hits[0] } : { entity: e, ccw };
  }
  const inside = inSweep(s, e, t);
  const ends = [e.start, e.end].sort((p, q) => travel(at(s, p)) - travel(at(s, q)));
  const [keep, replace] = inside ? ends : [ends[1], ends[0]];
  if (Math.abs(travel(at(s, keep))) < 1e-6 && inside) return null;
  if (corner !== null && (replace !== corner || !inside)) return null;
  return { entity: e, replace, keep, ccw };
}

/** Apply a cut: the curve now ends at the new point `tid`. */
function applyCut(s: SketchData, entities: SketchEntity[], points: SketchPoint[], cut: Cut, tid: number, id: () => number): SketchEntity[] {
  const e = cut.entity;
  return entities.map((x) => {
    if (x.id !== e.id) return x;
    if (x.type === "line") return { ...x, a: x.a === cut.replace ? tid : x.a, b: x.b === cut.replace ? tid : x.b };
    if (x.type === "arc") return cut.ccw ? { ...x, start: tid, end: cut.keep! } : { ...x, start: cut.keep!, end: tid };
    if (x.type !== "circle") return x;
    if (!cut.cross) return x;
    const end = id();
    points.push({ id: end, u: cut.cross[0], v: cut.cross[1] });
    return { id: x.id, type: "arc", center: x.center, ...(cut.ccw ? { start: tid, end } : { start: end, end: tid }), ...(x.construction ? { construction: true } : {}) };
  });
}

/** Constraints that stop being true once a curve is cut: the length, equal length or midpoint of a line. */
function staleAfterCut(c: SketchConstraint, cut: Cut): boolean {
  const names = c.entity === cut.entity.id || (c.entities?.includes(cut.entity.id) ?? false);
  return names && cut.entity.type === "line" && ["distance", "equal", "midpoint"].includes(c.type);
}

// The tools -----------------------------------------------------------------------------------------

function result(s: SketchData, kind: "fillet" | "chamfer", p: Pt, q: Pt, cuts: [Cut | null, Cut | null], tangents: Pt[], centre: Pt | null, corner: number | null): SketchData {
  let id = nextId(s);
  const next = () => id++;
  const points: SketchPoint[] = [];
  const mk = (pt: Pt): SketchPoint => {
    const point = { id: next(), u: pt[0], v: pt[1] };
    points.push(point);
    return point;
  };
  const t = [mk(tangents[0]), mk(tangents[1])];
  let entities = s.entities;
  const cutNow = (cut: Cut | null, k: number) => {
    if (cut) entities = applyCut(s, entities, points, cut, t[k].id, next);
  };
  cutNow(cuts[0], 0);
  cutNow(cuts[1], 1);
  const arcId = next();
  const constraints = s.constraints.filter((c) => !cuts.some((cut) => cut && staleAfterCut(c, cut)) && !(corner !== null && (c.point === corner || c.points?.includes(corner))));
  if (kind === "chamfer") entities = [...entities, { id: arcId, type: "line", a: t[0].id, b: t[1].id }];
  else {
    const centrePoint = mk(centre!);
    const ccw = (p[0] - centre![0]) * (q[1] - centre![1]) - (p[1] - centre![1]) * (q[0] - centre![0]) > 0;
    entities = [...entities, { id: arcId, type: "arc", center: centrePoint.id, start: (ccw ? t[0] : t[1]).id, end: (ccw ? t[1] : t[0]).id }];
    for (const cut of cuts) if (cut) constraints.push({ id: next(), type: "tangent", entities: [arcId, cut.entity.id], auto: true });
  }
  return dropOrphans({ ...s, points: [...s.points, ...points], entities, constraints });
}

/** Both curves at their tangent (fillet) or chamfer points; `corner` is the shared end point, if the curves meet at one. */
export function roundCurves(s: SketchData, aId: number, bId: number, kind: "fillet" | "chamfer", size: number, pointer: Pt, corner: number | null): SketchData | string {
  if (!(size > 1e-6)) return "Give a size above zero";
  const a = s.entities.find((e) => e.id === aId);
  const b = s.entities.find((e) => e.id === bId);
  if (!isCurve(a) || !isCurve(b) || a.id === b.id || a.reference || b.reference) return "Pick two lines, arcs or circles";
  const ga = geoOf(s, a);
  const gb = geoOf(s, b);
  if (kind === "fillet") {
    let best: { score: number; value: SketchData } | null = null;
    const cornerPt = corner !== null ? at(s, corner) : null;
    for (const oa of offsets(ga, size)) {
      for (const ob of offsets(gb, size)) {
        for (const centre of meet(oa, ob)) {
          const ta = touch(ga, centre, size);
          const tb = touch(gb, centre, size);
          if (len(sub(ta, tb)) < 1e-6) continue;
          const dirs = [a, b].map((e, i): Pt => {
            const from = i === 0 ? ta : tb;
            const chord = sub(i === 0 ? tb : ta, from);
            const g = i === 0 ? ga : gb;
            const along = g.line ? g.d : ccwTangent(g.c, from);
            return dot(along, chord) > 0 ? [-along[0], -along[1]] : along; // the kept part lies behind the arc's start
          });
          const cuts: [Cut | null, Cut | null] = [planCut(s, a, ta, dirs[0], b, corner), planCut(s, b, tb, dirs[1], a, corner)];
          if (!cuts[0] || !cuts[1]) continue;
          const score = len(sub(centre, pointer)) + (cornerPt ? 1e-7 * len(sub(centre, cornerPt)) : 0);
          if (!best || score < best.score) best = { score, value: result(s, kind, ta, tb, cuts, [ta, tb], centre, corner) };
        }
      }
    }
    return best ? best.value : corner !== null ? "The radius does not fit this corner" : "No fillet of this radius touches both curves";
  }
  // Chamfer: the points lie `size` along each curve from the corner, on the pointer's side where they cross.
  let x: Pt | null = null;
  if (corner !== null) x = at(s, corner);
  else {
    const hits = meet(ga, gb);
    hits.sort((p, q) => len(sub(p, pointer)) - len(sub(q, pointer)));
    x = hits[0] ?? null;
  }
  if (!x) return "The curves do not meet, so there is no corner to bevel";
  const ends: { t: Pt; k: Pt }[] = [];
  for (const e of [a, b]) {
    const g = geoOf(s, e);
    let along: Pt;
    if (g.line) along = g.d;
    else along = ccwTangent(g.c, x);
    let sign = 1;
    if (corner !== null) {
      // away from the corner, into the curve
      if (e.type === "line") sign = dot(sub(at(s, e.a === corner ? e.b : e.a), x), along) >= 0 ? 1 : -1;
      else if (e.type === "arc") sign = e.start === corner ? 1 : -1;
    } else sign = dot(sub(pointer, x), along) >= 0 ? 1 : -1;
    if (g.line) ends.push({ t: [x[0] + along[0] * sign * size, x[1] + along[1] * sign * size], k: [along[0] * sign, along[1] * sign] });
    else {
      const turn = (sign * size) / g.r;
      const ang = angleOf(g.c, x) + turn;
      const tpt: Pt = [g.c[0] + g.r * Math.cos(ang), g.c[1] + g.r * Math.sin(ang)];
      ends.push({ t: tpt, k: [ccwTangent(g.c, tpt)[0] * sign, ccwTangent(g.c, tpt)[1] * sign] });
    }
  }
  if (len(sub(ends[0].t, ends[1].t)) < 1e-6) return "The distance is too small";
  const cuts: [Cut | null, Cut | null] = [planCut(s, a, ends[0].t, ends[0].k, b, null), planCut(s, b, ends[1].t, ends[1].k, a, null)];
  if (!cuts[0] || !cuts[1]) return "The distance is larger than the curves at this corner";
  if (corner !== null) for (const cut of cuts) if (cut && cut.replace !== corner && cut.entity.type !== "circle") return "The distance is larger than the curves at this corner";
  // A circle is cut against the corner itself.
  for (const cut of cuts) if (cut && cut.entity.type === "circle") cut.cross = x;
  return result(s, kind, ends[0].t, ends[1].t, cuts, [ends[0].t, ends[1].t], null, corner);
}

/** The two arcs or lines that end at the point `corner`, if exactly two do. */
export function curvesAtCorner(s: SketchData, corner: number): [number, number] | null {
  const ends = s.entities.filter((e) => (e.type === "line" ? e.a === corner || e.b === corner : e.type === "arc" ? e.start === corner || e.end === corner : false));
  return ends.length === 2 && !s.entities.some((e) => !ends.includes(e) && (e.type === "ellipse" || e.type === "spline") && entityPoints(e).includes(corner)) ? [ends[0].id, ends[1].id] : null;
}
