/** Sketch data and the rules that need no DOM or WebGL: types, plane math, dimensions, trimming and snapping. Which constraints fit a selection lives in sketchconstraints.ts (re-exported here). */
import type { Dimension } from "./dimensions";
import { pointInRect, polylineInBox, type Rect } from "./boxselect.ts";
import { measure, radiusOf } from "./sketchconstraints.ts";
import { showNumber } from "./precision.ts";
import { positiveSweep, turnCounterclockwise, TWO_PI } from "./anglemath.ts";
import { crossings } from "./sketchintersect.ts";
export { crossings, crossingsWith } from "./sketchintersect.ts";
import { cross3, dot3, sub3, unit3 } from "./vec.ts";
import { tangentSpots } from "./sketchtangentmarks.ts";
import { awayFromNeighbours, coincidentDirection, coincidentSpot, fan, PAIRED_TURN, sameSpot, turn } from "./sketchmarkplace.ts";
import { AXIS_LINES, AXIS_POINTS, AXIS_U, AXIS_V, entityOf, entityPoints, frame, nextId, pointOf, toPlane, toWorld } from "./sketchdata.ts";
import type { PlaneData, SketchConstraint, SketchData, SketchEntity, SketchPoint, SketchSel } from "./sketchdata.ts";
import { polyline } from "./sketchcurves.ts";
const [sub, dot, cross, norm] = [sub3, dot3, cross3, unit3];
export * from "./sketchdata.ts";
export * from "./sketchcurves.ts";
export * from "./sketchconstraints.ts";
export * from "./sketchsmartdim.ts";

// Constraint rules ------------------------------------------------------------------------------------


export function describeConstraint(s: SketchData, c: SketchConstraint): string {
  const names: Record<string, string> = {
    horizontal: "Horizontal",
    vertical: "Vertical",
    coincident: "Coincident",
    fixed: "Fixed",
    parallel: "Parallel",
    perpendicular: "Perpendicular",
    equal: "Equal",
    tangent: "Tangent",
    point_on: "Point on",
    midpoint: "Midpoint",
    symmetric: "Symmetric",
    symmetric_point: "Symmetric about a point",
    collinear: "Collinear",
    block: "Lock",
    minor_radius: "Short radius",
    point_line_distance: "Point to line distance",
    distance: "Distance",
    horizontal_distance: "Horizontal distance",
    vertical_distance: "Vertical distance",
    radius: "Radius",
    diameter: "Diameter",
    angle: "Angle",
    round_gap: "Gap between",
  };
  const entityName = (e: number) => (e === AXIS_U ? "horizontal axis" : e === AXIS_V ? "vertical axis" : `#${e}`);
  const refs = [...(c.points ?? []).map((p) => `p${p}`), ...(c.point !== undefined ? [`p${c.point}`] : []), ...(c.entity !== undefined ? [entityName(c.entity)] : []), ...(c.entities ?? []).map(entityName)];
  void s;
  const value = c.reference ? measure(s, c) : c.value;
  return `${c.reference ? "Reference " : ""}${names[c.type] ?? c.type} ${refs.join(" ")}${value != null ? ` = ${showNumber(value)}` : ""}`;
}

/** What dimension placement knows about the closed regions: whether a sketch point lies inside one, and how far from the geometry to look. */
export interface Outside {
  inside(u: number, v: number): boolean;
  probe: number;
}

/** Dimension annotations (drawn by DimensionOverlay) for the sketch's dimensional constraints. */
export function dimensionsOf(s: SketchData, outside?: Outside): Dimension[] {
  const f = frame(s.plane);
  const out: Dimension[] = [];
  const world = (id: number) => toWorld(s.plane, pointOf(s, id).u, pointOf(s, id).v);
  /** A linear dimension on the side of its points that lies outside the closed regions, or where the user dragged it. */
  const linear = (c: SketchConstraint, text: string, a: number[], b: number[], direction: number[]): Dimension => {
    let o = direction;
    if (outside) {
      const mid = [0, 1, 2].map((k) => (a[k] + b[k]) / 2);
      const probe = (sign: number) => toPlane(s.plane, mid.map((x, k) => x + sign * o[k] * outside.probe));
      if (outside.inside(...probe(1)) && !outside.inside(...probe(-1))) o = o.map((x) => -x);
    }
    const made: Dimension = { kind: "linear", text, points: [a, b], offsetDirection: o };
    if (c.place) {
      const at = toWorld(s.plane, c.place[0], c.place[1]);
      made.offset = dot(sub(at, a), norm(o));
      made.slide = dot(sub(at, a.map((x, k) => (x + b[k]) / 2)), norm(sub(b, a)));
    }
    return made;
  };
  const placed = (c: SketchConstraint, fallback: number[]) => (c.place ? toWorld(s.plane, c.place[0], c.place[1]) : fallback);
  for (const c of s.constraints) {
    const value = c.reference ? measure(s, c) : c.value;
    if (value === undefined || value === null) continue;
    const first = out.length;
    const text = c.reference ? `(${showNumber(value)})` : showNumber(value);
    const entity = entityOf(s, c.entity);
    if (c.type === "distance") {
      const ends = entity && entity.type === "line" ? [entity.a, entity.b] : c.points!;
      const [a, b] = [world(ends[0]), world(ends[1])];
      const along = norm(sub(b, a));
      out.push(linear(c, text, a, b, cross(f.n, along)));
    } else if ((c.type === "horizontal_distance" || c.type === "vertical_distance") && true) {
      const horizontal = c.type === "horizontal_distance";
      const ids = entity && entity.type === "line" ? [entity.a, entity.b] : c.points!;
      const [pa, pb] = [pointOf(s, ids[0]), pointOf(s, ids[1])];
      const a = world(ids[0]);
      const corner = toWorld(s.plane, horizontal ? pb.u : pa.u, horizontal ? pa.v : pb.v);
      const side = horizontal ? f.y : f.x;
      // The dimension runs along the projected leg (a to corner) and sits on the side away from the other point.
      const away = horizontal ? (pb.v >= pa.v ? -1 : 1) : pb.u >= pa.u ? -1 : 1;
      out.push(linear(c, text, a, corner, side.map((x) => x * away)));
    } else if (c.type === "angle" && c.entities?.length === 2) {
      const lines = c.entities.map((id) => entityOf(s, id));
      if (lines.every((l) => l?.type === "line")) {
        const mids = (lines as Extract<SketchEntity, { type: "line" }>[]).map((l) => [(pointOf(s, l.a).u + pointOf(s, l.b).u) / 2, (pointOf(s, l.a).v + pointOf(s, l.b).v) / 2]);
        const arc = angleArc(s, c, lines as Extract<SketchEntity, { type: "line" }>[], mids, `∠${text}°`);
        out.push(arc ?? { kind: "tag", text: `∠${text}°`, points: [placed(c, toWorld(s.plane, (mids[0][0] + mids[1][0]) / 2, (mids[0][1] + mids[1][1]) / 2))] });
      }
    } else if (c.type === "round_gap" && c.entities?.length === 2) {
      const [ea, eb] = c.entities.map((id) => entityOf(s, id));
      if (ea && eb && (ea.type === "circle" || ea.type === "arc") && (eb.type === "circle" || eb.type === "arc")) {
        const [ca, cb] = [world(ea.center), world(eb.center)];
        const [ra, rb] = [radiusOf(s, ea), radiusOf(s, eb)];
        const apart = Math.hypot(...sub(cb, ca));
        // The spacing runs along the line of the centers, from rim to rim; concentric circles use the sketch's horizontal direction.
        const along = apart > 1e-9 ? norm(sub(cb, ca)) : f.x;
        const nested = apart <= Math.abs(ra - rb);
        const [outer, inner] = ra >= rb ? [[ca, ra], [cb, rb]] : [[cb, rb], [ca, ra]];
        const way = nested ? (ra >= rb ? along : along.map((x) => -x)) : along; // nested: from the outer center toward the inner one
        const [pa, pb] = nested
          ? [(outer[0] as number[]).map((x, k) => x + way[k] * (outer[1] as number)), (inner[0] as number[]).map((x, k) => x + way[k] * (inner[1] as number))]
          : [ca.map((x, k) => x + along[k] * ra), cb.map((x, k) => x - along[k] * rb)];
        out.push(linear(c, text, pa, pb, cross(f.n, along)));
      }
    } else if (c.type === "minor_radius" && entity && entity.type === "ellipse") {
      const [m, o] = [pointOf(s, entity.center), pointOf(s, entity.major)];
      const length = Math.hypot(o.u - m.u, o.v - m.v) || 1;
      out.push({ kind: "tag", text: `r${text}`, points: [placed(c, toWorld(s.plane, m.u - ((o.v - m.v) / length) * entity.minor, m.v + ((o.u - m.u) / length) * entity.minor))] });
    } else if (c.type === "point_line_distance" && entity && entity.type === "line" && c.point !== undefined) {
      const [la, lb, p] = [pointOf(s, entity.a), pointOf(s, entity.b), pointOf(s, c.point)];
      const length = Math.hypot(lb.u - la.u, lb.v - la.v) || 1;
      const t = ((p.u - la.u) * (lb.u - la.u) + (p.v - la.v) * (lb.v - la.v)) / (length * length);
      const foot = toWorld(s.plane, la.u + t * (lb.u - la.u), la.v + t * (lb.v - la.v));
      const at = world(c.point);
      // The dimension line runs from the line to the point (square to the line); its extension lines run along the line's direction.
      out.push(linear(c, text, foot, at, norm(sub(world(entity.b), world(entity.a)))));
    } else if ((c.type === "radius" || c.type === "diameter") && entity && (entity.type === "circle" || entity.type === "arc")) {
      const center = world(entity.center);
      const r = radiusOf(s, entity);
      let way: number[] = f.x; // the way a circle's leader leaves it: toward where it was dragged, else the first way that ends outside the closed regions
      if (c.place) way = norm(sub(toWorld(s.plane, c.place[0], c.place[1]), center));
      else if (outside) {
        const ways = [f.x, f.x.map((x) => -x), f.y, f.y.map((x) => -x)];
        way = ways.find((w) => !outside.inside(...toPlane(s.plane, center.map((x, k) => x + w[k] * (r + outside.probe))))) ?? f.x;
      }
      let extend: number[][][] | undefined;
      if (entity.type === "arc") {
        // An arc's leader touches the arc where it was dragged (the middle of the arc until then); past either end it sits on an
        // extension of the arc's circle, drawn dashed from that end (no geometry is added).
        const arcWay = arcLeaderWay(s, entity, c.place ?? null);
        way = [0, 1, 2].map((k) => arcWay.way[0] * f.x[k] + arcWay.way[1] * f.y[k]);
        extend = arcWay.extension.map(([p, q]) => [toWorld(s.plane, ...p), toWorld(s.plane, ...q)]);
      }
      const rim = [0, 1, 2].map((k) => center[k] + r * way[k]);
      const leader: Dimension = c.type === "radius" ? { kind: "radius", text: `R${text}`, points: [center, rim] } : { kind: "diameter", text: `Ø${text}`, points: [[0, 1, 2].map((k) => 2 * center[k] - rim[k]), rim] };
      if (extend?.length) leader.extend = extend;
      if (c.place) leader.labelAt = toWorld(s.plane, c.place[0], c.place[1]);
      out.push(leader);
    }
    for (const made of out.slice(first)) made.constraint = c.id;
  }
  return out;
}

/** The unit direction (in sketch coordinates) an arc's radius leader leaves the center in, and the dashed segments that carry the arc's circle
 *  from the nearer end to that direction when it lies outside the arc's sweep. `place` is where the leader was dragged (null: the arc's middle). */
export function arcLeaderWay(s: SketchData, arc: Extract<SketchEntity, { type: "arc" }>, place: [number, number] | null): { way: [number, number]; extension: [[number, number], [number, number]][] } {
  const c = pointOf(s, arc.center);
  const r = Math.hypot(pointOf(s, arc.start).u - c.u, pointOf(s, arc.start).v - c.v);
  const a0 = Math.atan2(pointOf(s, arc.start).v - c.v, pointOf(s, arc.start).u - c.u);
  const sweep = positiveSweep(Math.atan2(pointOf(s, arc.end).v - c.v, pointOf(s, arc.end).u - c.u) - a0);
  const turn = (a: number) => turnCounterclockwise(a - a0); // counterclockwise from the start
  const angle = place && Math.hypot(place[0] - c.u, place[1] - c.v) > 1e-9 ? Math.atan2(place[1] - c.v, place[0] - c.u) : a0 + sweep / 2;
  const way: [number, number] = [Math.cos(angle), Math.sin(angle)];
  const t = turn(angle);
  if (t <= sweep) return { way, extension: [] };
  // outside the sweep: extend from the end it is nearer to (going on past the end, or back before the start)
  const past = t - sweep; // beyond the end
  const before = TWO_PI - t; // before the start
  const from = past <= before ? a0 + sweep : a0;
  const to = past <= before ? a0 + sweep + past : a0 - before;
  const steps = Math.max(4, Math.ceil(Math.abs(to - from) / 0.15));
  const point = (a: number): [number, number] => [c.u + r * Math.cos(a), c.v + r * Math.sin(a)];
  return { way, extension: Array.from({ length: steps }, (_, i) => [point(from + ((to - from) * i) / steps), point(from + ((to - from) * (i + 1)) / steps)] as [[number, number], [number, number]]) };
}

const ARC_STEPS = 24;

/** An angle dimension drawn as an arc about the point where the two lines meet, in the sector the value sits in (where it was dragged, else toward the lines' middles). Null when the lines are parallel. */
function angleArc(s: SketchData, c: SketchConstraint, lines: Extract<SketchEntity, { type: "line" }>[], mids: number[][], text: string): Dimension | null {
  const [a0, a1, b0, b1] = [pointOf(s, lines[0].a), pointOf(s, lines[0].b), pointOf(s, lines[1].a), pointOf(s, lines[1].b)];
  const da = [a1.u - a0.u, a1.v - a0.v];
  const db = [b1.u - b0.u, b1.v - b0.v];
  const crossUV = (p: number[], q: number[]) => p[0] * q[1] - p[1] * q[0];
  const det = crossUV(da, db);
  if (Math.abs(det) < 1e-12 * (Math.hypot(...da) * Math.hypot(...db) || 1)) return null;
  const t = crossUV([b0.u - a0.u, b0.v - a0.v], db) / det;
  const apex = [a0.u + t * da[0], a0.v + t * da[1]];
  const unitUV = (p: number[]) => p.map((x) => x / (Math.hypot(...p) || 1));
  const [ua, ub] = [unitUV(da), unitUV(db)];
  const neg = (p: number[]) => p.map((x) => -x);
  // The two opposite sectors that hold this angle; the one the value was placed in (or faces the lines' middles) is drawn.
  const pair = c.outside ? [[ua, neg(ub)], [neg(ua), ub]] : [[ua, ub], [neg(ua), neg(ub)]];
  const toward = c.place ? [c.place[0] - apex[0], c.place[1] - apex[1]] : [(mids[0][0] + mids[1][0]) / 2 - apex[0], (mids[0][1] + mids[1][1]) / 2 - apex[1]];
  const score = ([r1, r2]: number[][]) => toward[0] * (r1[0] + r2[0]) + toward[1] * (r1[1] + r2[1]);
  const [r1, r2] = score(pair[1]) > score(pair[0]) ? pair[1] : pair[0];
  const radius = Math.max(Math.hypot(...toward) * (c.place ? 1 : 0.6), 1e-3);
  const start = Math.atan2(r1[1], r1[0]);
  const sweep = Math.atan2(crossUV(r1, r2), r1[0] * r2[0] + r1[1] * r2[1]);
  const at = (angle: number, r: number) => toWorld(s.plane, apex[0] + r * Math.cos(angle), apex[1] + r * Math.sin(angle));
  const points = [toWorld(s.plane, apex[0], apex[1]), ...Array.from({ length: ARC_STEPS + 1 }, (_, i) => at(start + (sweep * i) / ARC_STEPS, radius))];
  // Extension lines carry a short line out to the arc.
  const extend: number[][][] = [];
  for (const [ray, l] of [[r1, lines[0]], [r2, lines[1]]] as const) {
    const reach = Math.max(...[l.a, l.b].map((id) => (pointOf(s, id).u - apex[0]) * ray[0] + (pointOf(s, id).v - apex[1]) * ray[1]), 0);
    if (reach < radius) extend.push([toWorld(s.plane, apex[0] + ray[0] * reach, apex[1] + ray[1] * reach), toWorld(s.plane, apex[0] + ray[0] * radius, apex[1] + ray[1] * radius)]);
  }
  return { kind: "angle", text, points, extend };
}

/** Constraints whose mark is the icon of their button (the constraint buttons' labels) rather than text. */
const MARK_ICONS: Record<string, string> = { tangent: "Tangent / collinear", fixed: "Fixed", block: "Lock", equal: "Equal", point_on: "Coincident", coincident: "Coincident" };

const MARKS: Record<string, string> = {
  horizontal: "H",
  vertical: "V",
  parallel: "∥",
  perpendicular: "⟂",
  equal: "=",
  tangent: "T",
  fixed: "Fix",
  block: "Lock",
  point_on: "On",
  coincident: "Co",
  midpoint: "Mid",
  symmetric: "Sym",
  symmetric_point: "Sym",
  collinear: "Col",
};

/** Small tags that show where the non-dimension constraints act, drawn near the geometry they hold. Crowded ones drop out. */
export function constraintMarks(s: SketchData): Dimension[] {
  const centre = (e: SketchEntity): [number, number] => {
    const line = polyline(s, e);
    const mid = line[Math.floor(line.length / 2)] ?? [0, 0];
    return e.type === "line" ? [(line[0][0] + line[1][0]) / 2, (line[0][1] + line[1][1]) / 2] : mid;
  };
  const out: Dimension[] = [];
  /** The way a mark at (u, v) leaves its point: `preferred` (outside the profile where it can), then the other ways to try when that place is taken. */
  const leaving = (u: number, v: number, preferred: [number, number]) => {
    const from = toWorld(s.plane, u, v);
    const [outward, ...alternatives] = fan(preferred).map((angle) => toWorld(s.plane, u + Math.cos(angle), v + Math.sin(angle)).map((x, i) => x - from[i]));
    return { outward, alternatives };
  };
  const centres = s.entities.flatMap((e) => (e.type === "circle" || e.type === "arc" || e.type === "ellipse" ? [pointOf(s, e.center)] : [])).map((p) => toWorld(s.plane, p.u, p.v));
  // A vertex with both a Coincident and a Tangent mark shows them side by side about its one outside direction, so each starts from the places the other uses.
  const coincidents = s.constraints.flatMap((c) => { const at = coincidentSpot(s, c); return at ? [{ at, dir: coincidentDirection(s, c, at) }] : []; });
  const tangents = s.constraints.flatMap((c) => (c.type === "tangent" ? tangentSpots(s, c).map((t): [number, number] => [t.u, t.v]) : []));
  for (const c of s.constraints) {
    const text = MARKS[c.type];
    if (!text) continue;
    const icon = MARK_ICONS[c.type];
    if (c.type === "tangent") {
      // At the point where the curves touch, a little off the curve, not at the average of their middles.
      const spots = tangentSpots(s, c);
      for (const spot of spots) {
        const at = toWorld(s.plane, spot.u, spot.v);
        const withCoincident = coincidents.find((k) => sameSpot(k.at, [spot.u, spot.v]));
        out.push({ kind: "tag", text, points: [at], mark: true, constraint: c.id, icon, ...leaving(spot.u, spot.v, withCoincident ? turn(withCoincident.dir, -PAIRED_TURN) : spot.out) });
      }
      if (spots.length) continue;
    }
    if (c.type === "symmetric" || c.type === "symmetric_point") {
      // One mark at each of the mirrored points (and at the center point of a symmetry about a point), never at the average with the axis or line.
      for (const id of [...(c.points ?? []), ...(c.point !== undefined ? [c.point] : [])]) {
        const p = s.points.find((q) => q.id === id);
        if (p) out.push({ kind: "tag", text, points: [toWorld(s.plane, p.u, p.v)], mark: true, avoid: centres, constraint: c.id, icon, ...leaving(p.u, p.v, awayFromNeighbours(s, id)) }); // beside the point, so the vertex stays pickable
      }
      continue;
    }
    const pointIds = [...(c.points ?? []), ...(c.point !== undefined ? [c.point] : [])];
    const entityIds = [...(c.entities ?? []), ...(c.entity !== undefined ? [c.entity] : [])];
    // Equal (and any constraint on one curve alone) is marked beside each curve it names, off the curve, not between them or on the line.
    if (c.type === "equal" || (!pointIds.length && entityIds.length === 1)) {
      for (const id of entityIds) {
        const e = entityOf(s, id);
        if (!e) continue;
        const [u, v] = centre(e);
        out.push({ kind: "tag", text, points: [toWorld(s.plane, u, v)], mark: true, avoid: centres, constraint: c.id, icon, ...leaving(u, v, coincidentDirection(s, { id: c.id, type: "point_on", entity: id }, [u, v])) });
      }
      continue;
    }
    // A constraint on one point alone (Fixed, Lock) is marked beside the point, so the vertex stays pickable.
    if (pointIds.length === 1 && !entityIds.length) {
      const p = s.points.find((q) => q.id === pointIds[0]);
      if (p) out.push({ kind: "tag", text, points: [toWorld(s.plane, p.u, p.v)], mark: true, avoid: centres, constraint: c.id, icon, ...leaving(p.u, p.v, awayFromNeighbours(s, p.id)) });
      continue;
    }
    const anchors: [number, number][] = [];
    for (const id of [...(c.points ?? []), ...(c.point !== undefined ? [c.point] : [])]) {
      const p = s.points.find((q) => q.id === id);
      if (p) anchors.push([p.u, p.v]);
    }
    // A point on a curve is marked at the point itself, not between the point and the curve's middle.
    for (const id of c.type === "point_on" || c.type === "midpoint" ? [] : [...(c.entities ?? []), ...(c.entity !== undefined ? [c.entity] : [])]) {
      const e = entityOf(s, id);
      if (e) anchors.push(centre(e));
    }
    if (!anchors.length) continue;
    const [u, v] = [anchors.reduce((a, q) => a + q[0], 0) / anchors.length, anchors.reduce((a, q) => a + q[1], 0) / anchors.length];
    // A Coincident mark sits beside its point, not on it, so the point stays visible and pickable.
    const outside = c.type === "point_on" || c.type === "midpoint" || c.type === "coincident" ? coincidentDirection(s, c, [u, v]) : null;
    const beside = outside ? leaving(u, v, tangents.some((t) => sameSpot(t, [u, v])) ? turn(outside, PAIRED_TURN) : outside) : {};
    out.push({ kind: "tag", text, points: [toWorld(s.plane, u, v)], mark: true, avoid: centres, constraint: c.id, icon, ...beside });
  }
  return out;
}

/**
 * Fixed points for the model's origin as seen from a sketch plane: the origin projected onto the plane, and
 * where each principal axis meets the plane. Positions already taken by `existing` are left out.
 */
export function originPoints(plane: PlaneData, existing: SketchPoint[]): { u: number; v: number }[] {
  const f = frame(plane);
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const candidates: number[][] = [f.n.map((c) => dot(f.origin, f.n) * c)];
  for (const d of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
    const along = dot(f.n, d);
    if (Math.abs(along) > 1e-9) candidates.push(d.map((c) => (dot(f.n, f.origin) / along) * c));
  }
  const found: { u: number; v: number }[] = [];
  for (const c of candidates) {
    const [u, v] = toPlane(plane, c);
    if (Math.abs(u) > 1e6 || Math.abs(v) > 1e6) continue;
    if ([...existing, ...found].some((p) => Math.hypot(p.u - u, p.v - v) < 1e-6)) continue;
    found.push({ u, v });
  }
  return found;
}

/**
 * The principal axes projected onto a sketch plane, as lines in sketch coordinates (a point and a unit
 * direction), with the axis index (0 x, 1 y, 2 z). An axis square to the plane projects to a single point
 * (see `originPoints`) and gives no line. An axis off the plane is shown where it appears, not where it is.
 */
export function axisLines(plane: PlaneData): { u: number; v: number; du: number; dv: number; axis: number }[] {
  const f = frame(plane);
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const [u, v] = toPlane(plane, f.n.map((c) => dot(f.origin, f.n) * c)); // the origin dropped onto the plane
  const lines = [];
  for (const [axis, d] of [[1, 0, 0], [0, 1, 0], [0, 0, 1]].entries()) {
    const [du, dv] = [dot(d, f.x), dot(d, f.y)];
    const length = Math.hypot(du, dv);
    if (length < 1e-6) continue;
    lines.push({ u, v, du: du / length, dv: dv / length, axis });
  }
  return lines;
}

/**
 * The sketch's own axes: through the plane origin (the center of the face the sketch is made on) along its u and v
 * directions. `axis` is the model axis (0 x, 1 y, 2 z) each runs closest to, which gives its color.
 */
export function sketchAxes(plane: PlaneData): { u: number; v: number; du: number; dv: number; axis: number }[] {
  const f = frame(plane);
  const nearest = (d: number[]) => {
    const a = d.map(Math.abs);
    return a.indexOf(Math.max(...a));
  };
  return [
    { u: 0, v: 0, du: 1, dv: 0, axis: nearest(f.x) },
    { u: 0, v: 0, du: 0, dv: 1, axis: nearest(f.y) },
  ];
}

// Trim ------------------------------------------------------------------------------------------------

/**
 * Extend the end of a line nearest (u, v) to the first curve it would meet beyond that end. The end
 * point moves when only this line uses it; a point shared with other curves is replaced by a new one so
 * they stay put. Constraints on the line are dropped, as in trim. With nothing to reach it does nothing.
 */
export function extendLine(s: SketchData, entityId: number, u: number, v: number): SketchData {
  const e = s.entities.find((x) => x.id === entityId);
  if (!e || e.type !== "line" || e.reference) return s;
  const a = pointOf(s, e.a);
  const b = pointOf(s, e.b);
  const len2 = (b.u - a.u) ** 2 + (b.v - a.v) ** 2;
  if (len2 < 1e-12) return s;
  const click = ((u - a.u) * (b.u - a.u) + (v - a.v) * (b.v - a.v)) / len2;
  const atEnd = click >= 0.5;
  const ts = crossings(s, e);
  const t = atEnd ? ts.find((x) => x > 1 + 1e-6) : [...ts].reverse().find((x) => x < -1e-6);
  if (t === undefined) return s;

  const moved = { u: a.u + t * (b.u - a.u), v: a.v + t * (b.v - a.v) };
  const oldId = atEnd ? e.b : e.a;
  const shared = s.entities.some((x) => x.id !== entityId && entityPoints(x).includes(oldId));
  let points = s.points;
  let newId = oldId;
  if (shared) {
    newId = nextId(s);
    points = [...points, { id: newId, ...moved }];
  } else {
    points = points.map((p) => (p.id === oldId ? { ...p, ...moved } : p));
  }
  const entities = s.entities.map((x) => (x.id === entityId && x.type === "line" ? { ...x, [atEnd ? "b" : "a"]: newId } : x));
  const constraints = s.constraints.filter((c) => c.entity !== entityId && !c.entities?.includes(entityId));
  return dropOrphans({ ...s, points, entities, constraints });
}

/** Drop points no entity uses, with the constraints that name them. */
export function dropOrphans(s: SketchData): SketchData {
  const used = new Set(s.entities.flatMap(entityPoints));
  const orphans = new Set(s.points.filter((p) => !used.has(p.id) && !p.fixed).map((p) => p.id));
  const refs = (c: SketchConstraint) => [...(c.points ?? []), ...(c.point !== undefined ? [c.point] : [])];
  return { ...s, points: s.points.filter((p) => !orphans.has(p.id)), constraints: s.constraints.filter((c) => !refs(c).some((i) => orphans.has(i))) };
}

/** Round (arc, `size` = radius) or bevel (line, `size` = distance along each side) the corner where exactly two
 *  lines meet at `pointId`. The corner point and the two lines stay as construction lines with all their constraints and
 *  dimensions, so a dimensioned shape keeps its size; the rounded outline is new lines (sharing the far ends of the old
 *  ones, with their new ends held on the old lines) and the arc or bevel. Returns the new sketch, or a message saying why the corner can't be changed. */
export function roundCorner(s: SketchData, pointId: number, kind: "fillet" | "chamfer", size: number): SketchData | string {
  if (!(size > 1e-6)) return "Give a size above zero";
  const point = s.points.find((p) => p.id === pointId);
  const users = s.entities.filter((e) => entityPoints(e).includes(pointId) && !e.construction);
  if (!point || users.length !== 2 || users.some((e) => e.type !== "line")) return "Select a corner where exactly two lines meet";
  const lines = users as Extract<SketchEntity, { type: "line" }>[];
  const far = lines.map((l) => s.points.find((p) => p.id === (l.a === pointId ? l.b : l.a))!);
  const arms = far.map((f) => {
    const length = Math.hypot(f.u - point.u, f.v - point.v);
    return { length, du: (f.u - point.u) / length, dv: (f.v - point.v) / length };
  });
  const cos = arms[0].du * arms[1].du + arms[0].dv * arms[1].dv;
  const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
  if (angle < 1e-3 || angle > Math.PI - 1e-3) return "The two lines are parallel";
  const reach = kind === "fillet" ? size / Math.tan(angle / 2) : size;
  if (reach > Math.min(arms[0].length, arms[1].length) * 0.999) return "The size is larger than the lines at this corner";
  let id = nextId(s);
  const make = (u: number, v: number): SketchPoint => ({ id: id++, u, v });
  const t = arms.map((a) => make(point.u + a.du * reach, point.v + a.dv * reach));
  const added: SketchPoint[] = [...t];
  // The old lines (and the corner point) stay whole as construction lines, so their constraints and dimensions keep meaning; the outline is made of new lines.
  const entities: SketchEntity[] = s.entities.map((e) => (e.type === "line" && lines.some((l) => l.id === e.id) ? { ...e, construction: true } : e));
  const outline = lines.map((l, k): SketchEntity => ({ id: id++, type: "line", a: far[k].id, b: t[k].id }));
  entities.push(...outline);
  const constraints = [...s.constraints];
  lines.forEach((l, k) => constraints.push({ id: id++, type: "point_on", point: t[k].id, entity: l.id, auto: true }));
  if (kind === "chamfer") {
    entities.push({ id: id++, type: "line", a: t[0].id, b: t[1].id });
    // The cut-off ends of the two lines as construction lines held equal, so an undimensioned chamfer stays the same distance from the corner on both sides.
    const cut = t.map((end): SketchEntity => ({ id: id++, type: "line", a: pointId, b: end.id, construction: true }));
    entities.push(...cut);
    constraints.push({ id: id++, type: "equal", entities: [cut[0].id, cut[1].id], auto: true });
    constraints.push({ id: id++, type: "distance", points: [pointId, t[0].id], value: size }); // the chamfer's size, a driving dimension
  } else {
    const bx = arms[0].du + arms[1].du;
    const by = arms[0].dv + arms[1].dv;
    const bl = Math.hypot(bx, by);
    const dist = size / Math.sin(angle / 2);
    const centre = make(point.u + (bx / bl) * dist, point.v + (by / bl) * dist);
    added.push(centre);
    // Arcs run counterclockwise from start to end.
    const ccw = (t[0].u - centre.u) * (t[1].v - centre.v) - (t[0].v - centre.v) * (t[1].u - centre.u) > 0;
    const arc = id++;
    entities.push({ id: arc, type: "arc", center: centre.id, start: (ccw ? t[0] : t[1]).id, end: (ccw ? t[1] : t[0]).id });
    constraints.push({ id: id++, type: "tangent", entities: [arc, outline[0].id], auto: true }, { id: id++, type: "tangent", entities: [arc, outline[1].id], auto: true });
    constraints.push({ id: id++, type: "radius", entity: arc, value: size }); // the fillet's radius, a driving dimension
  }
  return { ...s, points: [...s.points, ...added], entities, constraints };
}

/** The sketch's points and curves a screen box selects. Window (left to right): wholly inside. Crossing (right to left): inside or touched. */
export function itemsInBox(s: SketchData, toScreen: (u: number, v: number) => { x: number; y: number }, r: Rect, crossing: boolean): SketchSel[] {
  const found: SketchSel[] = [];
  for (const p of s.points) if (pointInRect(toScreen(p.u, p.v), r)) found.push({ kind: "point", id: p.id });
  for (const e of s.entities) {
    const pts = polyline(s, e).map(([u, v]) => toScreen(u, v));
    if (polylineInBox(pts, r, crossing)) found.push({ kind: "entity", id: e.id });
  }
  return found;
}

/**
 * The part of the sketch the constraint solver needs. Projected model edges are fixed reference geometry that
 * nothing is tied to; sending them all can exceed the solver's limit on unknowns, which made every solve fail
 * (nothing could be dragged or constrained). Reference curves and fixed points no constraint or kept curve uses are left out.
 */
export function forSolver(s: SketchData, withAxes = true): SketchData {
  const usedPoints = new Set<number>();
  const usedEntities = new Set<number>();
  for (const c of s.constraints) {
    for (const id of c.points ?? []) usedPoints.add(id);
    if (c.point !== undefined) usedPoints.add(c.point);
    if (c.entity !== undefined) usedEntities.add(c.entity);
    for (const id of c.entities ?? []) usedEntities.add(id);
  }
  const entities = s.entities.filter((e) => !e.reference || usedEntities.has(e.id));
  for (const e of entities) for (const id of entityPoints(e)) usedPoints.add(id);
  const points = s.points.filter((p) => !p.fixed || usedPoints.has(p.id));
  // An axis a constraint refers to is sent as a fixed line (never to the region search: it would cut every face it crosses).
  const axes = withAxes ? AXIS_LINES.filter((e) => usedEntities.has(e.id)) : [];
  if (axes.length) points.push(...AXIS_POINTS.filter((p) => axes.some((e) => e.type === "line" && (e.a === p.id || e.b === p.id))));
  return entities.length === s.entities.length && points.length === s.points.length && !axes.length ? s : { ...s, points, entities: [...entities, ...axes] };
}
