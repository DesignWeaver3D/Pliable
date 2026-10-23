/** Sketch data and the rules that need no DOM or WebGL: types, plane math, dimensions, trimming and snapping. Which constraints fit a selection lives in sketchconstraints.ts (re-exported here). */
import type { Dimension } from "./dimensions";
import { pointInRect, polylineInBox, type Rect } from "./boxselect.ts";
import { measure, radiusOf } from "./sketchconstraints.ts";
export * from "./sketchconstraints.ts";

export interface PlaneData {
  origin: number[];
  normal: number[];
  xdir: number[];
}
export interface SketchPoint {
  id: number;
  u: number;
  v: number;
  /** Reference geometry copied from the model: the solver never moves it. */
  fixed?: boolean;
}
export type SketchEntity =
  | { id: number; type: "line"; a: number; b: number; construction?: boolean; reference?: boolean }
  | { id: number; type: "circle"; center: number; radius: number; construction?: boolean; reference?: boolean }
  | { id: number; type: "arc"; center: number; start: number; end: number; construction?: boolean; reference?: boolean }
  /** Centre, the end of the major semi-axis, and the minor radius. Only its two points take constraints. */
  | { id: number; type: "ellipse"; center: number; major: number; minor: number; construction?: boolean; reference?: boolean }
  /** A smooth curve through its points in order (a closed one joins last to first). Only its points take constraints. */
  | { id: number; type: "spline"; points: number[]; closed?: boolean; construction?: boolean; reference?: boolean };
export interface SketchConstraint {
  id: number;
  type: string;
  points?: number[];
  point?: number;
  entity?: number;
  entities?: number[];
  value?: number;
  /** A dimension that only reports the current measurement (shown in brackets); the solver ignores it. */
  reference?: boolean;
  /** Added by a drawing tool rather than chosen by the user; shown as such and removable with one click. */
  auto?: boolean;
  /** Where the user dragged this dimension's text to, in sketch coordinates (display only; the solver ignores it). */
  place?: [number, number];
}
export interface SketchData {
  plane: PlaneData;
  points: SketchPoint[];
  entities: SketchEntity[];
  constraints: SketchConstraint[];
}
export type SketchSel = { kind: "point" | "entity"; id: number };

export type Vec3 = [number, number, number];
const sub = (a: number[], b: number[]): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: number[]): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Unit axes of a plane, matching the core's `frame` (x made perpendicular to the normal, y = normal x x). */
export function frame(plane: PlaneData): { origin: Vec3; x: Vec3; y: Vec3; n: Vec3 } {
  const n = norm(plane.normal);
  const d = dot(plane.xdir, n);
  const x = norm(sub(plane.xdir, [n[0] * d, n[1] * d, n[2] * d]));
  return { origin: plane.origin as Vec3, x, y: cross(n, x), n };
}

export function toWorld(plane: PlaneData, u: number, v: number): Vec3 {
  const f = frame(plane);
  return [0, 1, 2].map((k) => f.origin[k] + u * f.x[k] + v * f.y[k]) as Vec3;
}

export function toPlane(plane: PlaneData, p: number[]): [number, number] {
  const f = frame(plane);
  const d = sub(p, f.origin);
  return [dot(d, f.x), dot(d, f.y)];
}

export function pointOf(s: SketchData, id: number): SketchPoint {
  const p = s.points.find((q) => q.id === id);
  if (!p) throw new Error(`no point ${id}`);
  return p;
}

export function nextId(s: SketchData): number {
  return 1 + Math.max(0, ...s.points.map((p) => p.id), ...s.entities.map((e) => e.id), ...s.constraints.map((c) => c.id));
}

/** Points an entity is made of (line ends; circle and arc: center first). */
export function entityPoints(e: SketchEntity): number[] {
  return e.type === "line" ? [e.a, e.b] : e.type === "circle" ? [e.center] : e.type === "ellipse" ? [e.center, e.major] : e.type === "spline" ? [...e.points] : [e.center, e.start, e.end];
}

/** Remove a point or entity with everything that depends on it; points no entity uses any more go too. */
export function remove(s: SketchData, sel: SketchSel): SketchData {
  let entities = s.entities;
  let constraints = s.constraints;
  const dropEntity = (id: number) => {
    entities = entities.filter((e) => e.id !== id);
    constraints = constraints.filter((c) => c.entity !== id && !c.entities?.includes(id));
  };
  if (sel.kind === "entity") dropEntity(sel.id);
  else for (const e of entities.filter((e) => entityPoints(e).includes(sel.id))) dropEntity(e.id);
  const used = new Set(entities.flatMap(entityPoints));
  const orphans = new Set(s.points.filter((p) => !used.has(p.id) && !p.fixed).map((p) => p.id));
  const refs = (c: SketchConstraint) => [...(c.points ?? []), ...(c.point !== undefined ? [c.point] : [])];
  constraints = constraints.filter((c) => !refs(c).some((id) => orphans.has(id)));
  return { ...s, entities, constraints, points: s.points.filter((p) => !orphans.has(p.id)) };
}

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
    axis_angle: "Angle to horizontal axis",
  };
  const refs = [...(c.points ?? []).map((p) => `p${p}`), ...(c.point !== undefined ? [`p${c.point}`] : []), ...(c.entity !== undefined ? [`#${c.entity}`] : []), ...(c.entities ?? []).map((e) => `#${e}`)];
  void s;
  const value = c.reference ? measure(s, c) : c.value;
  return `${c.reference ? "Reference " : ""}${names[c.type] ?? c.type} ${refs.join(" ")}${value != null ? ` = ${parseFloat(value.toFixed(3))}` : ""}`;
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
    const text = c.reference ? `(${parseFloat(value.toFixed(3))})` : parseFloat(value.toFixed(3)).toString();
    const entity = s.entities.find((e) => e.id === c.entity);
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
    } else if (c.type === "axis_angle" && entity && entity.type === "line") {
      const [a, b] = [pointOf(s, entity.a), pointOf(s, entity.b)];
      out.push({ kind: "tag", text: `∠${text}°`, points: [placed(c, toWorld(s.plane, (a.u + b.u) / 2, (a.v + b.v) / 2))] });
    } else if (c.type === "angle" && c.entities?.length === 2) {
      const lines = c.entities.map((id) => s.entities.find((e) => e.id === id));
      if (lines.every((l) => l?.type === "line")) {
        const mids = (lines as Extract<SketchEntity, { type: "line" }>[]).map((l) => [(pointOf(s, l.a).u + pointOf(s, l.b).u) / 2, (pointOf(s, l.a).v + pointOf(s, l.b).v) / 2]);
        out.push({ kind: "tag", text: `∠${text}°`, points: [placed(c, toWorld(s.plane, (mids[0][0] + mids[1][0]) / 2, (mids[0][1] + mids[1][1]) / 2))] });
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
      out.push(linear(c, text, foot, at, norm(sub(at, foot)).map((x) => -x)));
    } else if ((c.type === "radius" || c.type === "diameter") && entity && (entity.type === "circle" || entity.type === "arc")) {
      const center = world(entity.center);
      const r = radiusOf(s, entity);
      let way: number[] = f.x; // the way a circle's leader leaves it: toward where it was dragged, else the first way that ends outside the closed regions
      if (c.place) way = norm(sub(toWorld(s.plane, c.place[0], c.place[1]), center));
      else if (outside) {
        const ways = [f.x, f.x.map((x) => -x), f.y, f.y.map((x) => -x)];
        way = ways.find((w) => !outside.inside(...toPlane(s.plane, center.map((x, k) => x + w[k] * (r + outside.probe))))) ?? f.x;
      }
      const rim = entity.type === "circle" ? [0, 1, 2].map((k) => center[k] + r * way[k]) : world(entity.start);
      const leader: Dimension = c.type === "radius" ? { kind: "radius", text: `R${text}`, points: [center, rim] } : { kind: "diameter", text: `⌀${text}`, points: [[0, 1, 2].map((k) => 2 * center[k] - rim[k]), rim] };
      if (c.place) leader.labelAt = toWorld(s.plane, c.place[0], c.place[1]);
      out.push(leader);
    }
    for (const made of out.slice(first)) made.constraint = c.id;
  }
  return out;
}

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
  midpoint: "Mid",
  symmetric: "Sym",
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
  for (const c of s.constraints) {
    const text = MARKS[c.type];
    if (!text) continue;
    const anchors: [number, number][] = [];
    for (const id of [...(c.points ?? []), ...(c.point !== undefined ? [c.point] : [])]) {
      const p = s.points.find((q) => q.id === id);
      if (p) anchors.push([p.u, p.v]);
    }
    for (const id of [...(c.entities ?? []), ...(c.entity !== undefined ? [c.entity] : [])]) {
      const e = s.entities.find((x) => x.id === id);
      if (e) anchors.push(centre(e));
    }
    if (!anchors.length) continue;
    const [u, v] = [anchors.reduce((a, q) => a + q[0], 0) / anchors.length, anchors.reduce((a, q) => a + q[1], 0) / anchors.length];
    out.push({ kind: "tag", text, points: [toWorld(s.plane, u, v)] });
  }
  return out;
}

/** A smooth (Catmull-Rom) curve through the spline's points, sampled for drawing and picking. */
function splinePolyline(s: SketchData, e: Extract<SketchEntity, { type: "spline" }>, segments: number): [number, number][] {
  const pts = e.points.map((id) => pointOf(s, id));
  const n = pts.length;
  if (n < 2) return [];
  const at = (i: number) => (e.closed && n > 2 ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const spans = e.closed && n > 2 ? n : n - 1;
  const per = Math.max(4, Math.ceil(segments / 4));
  const out: [number, number][] = [];
  for (let i = 0; i < spans; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    for (let k = 0; k < per; k++) {
      const t = k / per;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
      out.push([f(p0.u, p1.u, p2.u, p3.u), f(p0.v, p1.v, p2.v, p3.v)]);
    }
  }
  const last = at(spans);
  out.push([last.u, last.v]);
  return out;
}

/** Polyline of an entity in sketch coordinates (circles and arcs sampled), for drawing and picking. */
export function polyline(s: SketchData, e: SketchEntity, segments = 48): [number, number][] {
  if (e.type === "line") return [[pointOf(s, e.a).u, pointOf(s, e.a).v], [pointOf(s, e.b).u, pointOf(s, e.b).v]];
  if (e.type === "spline") return splinePolyline(s, e, segments);
  const c = pointOf(s, e.center);
  if (e.type === "ellipse") {
    const m = pointOf(s, e.major);
    const a = Math.hypot(m.u - c.u, m.v - c.v) || 1e-9;
    const [ux, uy] = [(m.u - c.u) / a, (m.v - c.v) / a];
    return Array.from({ length: segments + 1 }, (_, i) => {
      const t = (2 * Math.PI * i) / segments;
      const x = a * Math.cos(t);
      const y = e.minor * Math.sin(t);
      return [c.u + x * ux - y * uy, c.v + x * uy + y * ux];
    });
  }
  if (e.type === "circle") {
    return Array.from({ length: segments + 1 }, (_, i) => [c.u + e.radius * Math.cos((2 * Math.PI * i) / segments), c.v + e.radius * Math.sin((2 * Math.PI * i) / segments)]);
  }
  const start = pointOf(s, e.start);
  const end = pointOf(s, e.end);
  const r = Math.hypot(start.u - c.u, start.v - c.v);
  const a0 = Math.atan2(start.v - c.v, start.u - c.u);
  let sweep = Math.atan2(end.v - c.v, end.u - c.u) - a0;
  if (sweep <= 0) sweep += 2 * Math.PI; // arcs run counterclockwise
  return Array.from({ length: segments + 1 }, (_, i) => [c.u + r * Math.cos(a0 + (sweep * i) / segments), c.v + r * Math.sin(a0 + (sweep * i) / segments)]);
}

/** Distance from (u, v) to an entity's polyline. */
export function distanceTo(s: SketchData, e: SketchEntity, u: number, v: number): number {
  const line = polyline(s, e);
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, ay] = line[i];
    const [bx, by] = line[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((u - ax) * dx + (v - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(u - (ax + t * dx), v - (ay + t * dy)));
  }
  return best;
}

/** The point of entity `e` nearest to (u, v), or null for a degenerate entity. */
export function closestOn(s: SketchData, e: SketchEntity, u: number, v: number): [number, number] | null {
  const line = polyline(s, e);
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, ay] = line[i];
    const [bx, by] = line[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((u - ax) * dx + (v - ay) * dy) / (dx * dx + dy * dy || 1)));
    const p: [number, number] = [ax + t * dx, ay + t * dy];
    const d = Math.hypot(u - p[0], v - p[1]);
    if (d < bestD) (bestD = d), (best = p);
  }
  return best;
}

/**
 * Radius at which a circle about `centre` would touch an existing curve, if that is within `reach` of the
 * radius the cursor asks for. Returns the touching entity and the point on the cursor's ray at that radius.
 */
export function tangentRadius(s: SketchData, centre: { u: number; v: number }, u: number, v: number, reach: number): { u: number; v: number; entity: number } | null {
  const ask = Math.hypot(u - centre.u, v - centre.v);
  if (ask < 1e-9) return null;
  let best: { radius: number; entity: number; gap: number } | null = null;
  const consider = (radius: number, entity: number, touch: [number, number], tol = 1e-6) => {
    const gap = Math.abs(radius - ask);
    if (radius > 1e-6 && gap < reach && (!best || gap < best.gap) && distanceTo(s, s.entities.find((x) => x.id === entity)!, touch[0], touch[1]) < tol) best = { radius, entity, gap };
  };
  for (const e of s.entities) {
    if (e.type === "line") {
      const a = pointOf(s, e.a);
      const b = pointOf(s, e.b);
      const dx = b.u - a.u;
      const dy = b.v - a.v;
      const t = ((centre.u - a.u) * dx + (centre.v - a.v) * dy) / (dx * dx + dy * dy || 1);
      const foot: [number, number] = [a.u + t * dx, a.v + t * dy];
      if (t >= 0 && t <= 1) consider(Math.hypot(foot[0] - centre.u, foot[1] - centre.v), e.id, foot);
    } else if (e.type === "circle" || e.type === "arc") {
      const c = pointOf(s, e.center);
      const r = e.type === "circle" ? e.radius : Math.hypot(pointOf(s, e.start).u - c.u, pointOf(s, e.start).v - c.v);
      const d = Math.hypot(c.u - centre.u, c.v - centre.v);
      if (d < 1e-9) continue;
      const dir = [(c.u - centre.u) / d, (c.v - centre.v) / d];
      // |d - r| touches the near side of the other circle, d + r the far side.
      consider(Math.abs(d - r), e.id, [c.u - dir[0] * r, c.v - dir[1] * r], 0.01 * (1 + r));
      consider(d + r, e.id, [c.u + dir[0] * r, c.v + dir[1] * r], 0.01 * (1 + r));
    }
  }
  const hit = best as { radius: number; entity: number } | null;
  if (!hit) return null;
  return { u: centre.u + ((u - centre.u) / ask) * hit.radius, v: centre.v + ((v - centre.v) / ask) * hit.radius, entity: hit.entity };
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
 * Point on a circle or arc where a line from `from` would just touch it, if that is within `reach` of the
 * cursor (u, v). Used to snap the end of a line being drawn so it leaves tangent to the curve.
 */
export function tangentFrom(s: SketchData, from: { u: number; v: number }, u: number, v: number, reach: number): { u: number; v: number; entity: number } | null {
  let best: { u: number; v: number; entity: number; gap: number } | null = null;
  for (const e of s.entities) {
    if (e.type !== "circle" && e.type !== "arc") continue;
    const c = pointOf(s, e.center);
    const r = e.type === "circle" ? e.radius : Math.hypot(pointOf(s, e.start).u - c.u, pointOf(s, e.start).v - c.v);
    const d = Math.hypot(from.u - c.u, from.v - c.v);
    if (d <= r * 1.0001) continue;
    const base = Math.atan2(from.v - c.v, from.u - c.u);
    const spread = Math.acos(r / d);
    for (const angle of [base + spread, base - spread]) {
      const t: [number, number] = [c.u + r * Math.cos(angle), c.v + r * Math.sin(angle)];
      const gap = Math.hypot(t[0] - u, t[1] - v);
      if (gap < reach && (!best || gap < best.gap) && distanceTo(s, e, t[0], t[1]) < 0.01 * (1 + r)) best = { u: t[0], v: t[1], entity: e.id, gap };
    }
  }
  return best;
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
 * The sketch's own axes: through the plane origin (the centre of the face the sketch is made on) along its u and v
 * directions. `axis` is the model axis (0 x, 1 y, 2 z) each runs closest to, which gives its colour.
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

/** Parameters t along line `e` (0 at its start, 1 at its end, unbounded) where it meets other lines and circles. */
function crossings(s: SketchData, e: Extract<SketchEntity, { type: "line" }>): number[] {
  const a = pointOf(s, e.a);
  const b = pointOf(s, e.b);
  const dx = b.u - a.u;
  const dy = b.v - a.v;
  const ts: number[] = [];
  for (const o of s.entities) {
    if (o.id === e.id) continue;
    if (o.type === "line") {
      const c = pointOf(s, o.a);
      const d = pointOf(s, o.b);
      const ex = d.u - c.u;
      const ey = d.v - c.v;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((c.u - a.u) * ey - (c.v - a.v) * ex) / den;
      const w = ((c.u - a.u) * dy - (c.v - a.v) * dx) / den;
      if (w >= -1e-9 && w <= 1 + 1e-9) ts.push(t);
    } else if (o.type === "circle") {
      const c = pointOf(s, o.center);
      const fx = a.u - c.u;
      const fy = a.v - c.v;
      const qa = dx * dx + dy * dy;
      const qb = 2 * (fx * dx + fy * dy);
      const qc = fx * fx + fy * fy - o.radius * o.radius;
      const disc = qb * qb - 4 * qa * qc;
      if (disc < 0 || qa < 1e-12) continue;
      const root = Math.sqrt(disc);
      ts.push((-qb - root) / (2 * qa), (-qb + root) / (2 * qa));
    }
  }
  return ts.sort((x, y) => x - y);
}

/**
 * Trim the part of a line under (u, v) that lies between its nearest crossings with other curves.
 * A piece at an end shortens the line; a piece in the middle splits it in two. Constraints on the
 * trimmed line are dropped (its end points may have moved); with no crossing the whole line goes.
 */
export function trimLine(s: SketchData, entityId: number, u: number, v: number): SketchData {
  const e = s.entities.find((x) => x.id === entityId);
  if (!e || e.type !== "line" || e.reference) return s;
  const a = pointOf(s, e.a);
  const b = pointOf(s, e.b);
  const len2 = (b.u - a.u) ** 2 + (b.v - a.v) ** 2;
  if (len2 < 1e-12) return s;
  const click = Math.min(1, Math.max(0, ((u - a.u) * (b.u - a.u) + (v - a.v) * (b.v - a.v)) / len2));
  const ts = crossings(s, e).filter((t) => t > 1e-6 && t < 1 - 1e-6);
  const lo = [...ts].reverse().find((t) => t <= click);
  const hi = ts.find((t) => t >= click);
  if (lo === undefined && hi === undefined) return remove(s, { kind: "entity", id: entityId });

  let id = nextId(s);
  const points = [...s.points];
  const at = (t: number) => {
    const p = { id: id++, u: a.u + t * (b.u - a.u), v: a.v + t * (b.v - a.v) };
    points.push(p);
    return p.id;
  };
  const kept = s.entities.filter((x) => x.id !== entityId);
  const entities: SketchEntity[] = [...kept];
  const flags = { construction: e.construction };
  if (lo !== undefined) entities.push({ id: id++, type: "line", a: e.a, b: at(lo), ...flags });
  if (hi !== undefined) entities.push({ id: id++, type: "line", a: at(hi), b: e.b, ...flags });
  const constraints = s.constraints.filter((c) => c.entity !== entityId && !c.entities?.includes(entityId));
  return dropOrphans({ ...s, points, entities, constraints });
}

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
function dropOrphans(s: SketchData): SketchData {
  const used = new Set(s.entities.flatMap(entityPoints));
  const orphans = new Set(s.points.filter((p) => !used.has(p.id) && !p.fixed).map((p) => p.id));
  const refs = (c: SketchConstraint) => [...(c.points ?? []), ...(c.point !== undefined ? [c.point] : [])];
  return { ...s, points: s.points.filter((p) => !orphans.has(p.id)), constraints: s.constraints.filter((c) => !refs(c).some((i) => orphans.has(i))) };
}

/** Round (arc, `size` = radius) or bevel (line, `size` = distance along each side) the corner where exactly two
 *  lines meet at `pointId`. Returns the new sketch, or a message saying why the corner can't be changed. */
export function roundCorner(s: SketchData, pointId: number, kind: "fillet" | "chamfer", size: number): SketchData | string {
  if (!(size > 1e-6)) return "Give a size above zero";
  const point = s.points.find((p) => p.id === pointId);
  const users = s.entities.filter((e) => entityPoints(e).includes(pointId));
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
  const entities: SketchEntity[] = s.entities.map((e) => {
    if (e.type !== "line") return e;
    const k = lines.findIndex((l) => l.id === e.id);
    if (k < 0) return e;
    return { ...e, a: e.a === pointId ? t[k].id : e.a, b: e.b === pointId ? t[k].id : e.b };
  });
  const constraints = s.constraints.filter((c) => c.point !== pointId && !c.points?.includes(pointId));
  if (kind === "chamfer") {
    entities.push({ id: id++, type: "line", a: t[0].id, b: t[1].id });
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
    constraints.push({ id: id++, type: "tangent", entities: [arc, lines[0].id], auto: true }, { id: id++, type: "tangent", entities: [arc, lines[1].id], auto: true });
  }
  return { ...s, points: [...s.points.filter((p) => p.id !== pointId), ...added], entities, constraints };
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
export function forSolver(s: SketchData): SketchData {
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
  return entities.length === s.entities.length && points.length === s.points.length ? s : { ...s, points, entities };
}
