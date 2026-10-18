/** Sketch data and the rules that need no DOM or WebGL: types, plane math, which constraints fit a selection. */
import type { Dimension } from "./dimensions";

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
  | { id: number; type: "arc"; center: number; start: number; end: number; construction?: boolean; reference?: boolean };
export interface SketchConstraint {
  id: number;
  type: string;
  points?: number[];
  point?: number;
  entity?: number;
  entities?: number[];
  value?: number;
  /** Added by a drawing tool rather than chosen by the user; shown as such and removable with one click. */
  auto?: boolean;
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
  return e.type === "line" ? [e.a, e.b] : e.type === "circle" ? [e.center] : [e.center, e.start, e.end];
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

export interface ConstraintOption {
  label: string;
  /** Builds the constraint from the selection, or null if this option does not fit it. */
  build(s: SketchData, sel: SketchSel[]): Omit<SketchConstraint, "id"> | null;
  /** For dimensions: the value the dialog starts with, from the current geometry. */
  initial?(s: SketchData, sel: SketchSel[]): number;
  dimension?: boolean;
}

const entities = (s: SketchData, sel: SketchSel[]) => sel.filter((x) => x.kind === "entity").map((x) => s.entities.find((e) => e.id === x.id)!);
const pts = (sel: SketchSel[]) => sel.filter((x) => x.kind === "point").map((x) => x.id);
const only = (list: SketchEntity[], ...types: string[]) => list.length > 0 && list.every((e) => types.includes(e.type));
const dist = (s: SketchData, a: number, b: number) => Math.hypot(pointOf(s, a).u - pointOf(s, b).u, pointOf(s, a).v - pointOf(s, b).v);
const radiusOf = (s: SketchData, e: SketchEntity) => (e.type === "circle" ? e.radius : e.type === "arc" ? dist(s, e.center, e.start) : 0);

/** The two points a selection measures between: a line's ends, or two selected points. */
function ends(s: SketchData, sel: SketchSel[]): [number, number] {
  const line = entities(s, sel)[0];
  return line && line.type === "line" ? [line.a, line.b] : [pts(sel)[0], pts(sel)[1]];
}

/** The table that decides which constraint buttons appear for a selection. Edit here to add or reorder. */
export const CONSTRAINT_OPTIONS: ConstraintOption[] = [
  {
    label: "Horizontal",
    build: (s, sel) => {
      const es = entities(s, sel);
      if (es.length === 1 && only(es, "line") && !pts(sel).length) return { type: "horizontal", entity: es[0].id };
      const p = pts(sel);
      return p.length === 2 && !es.length ? { type: "horizontal", points: p } : null;
    },
  },
  {
    label: "Vertical",
    build: (s, sel) => {
      const es = entities(s, sel);
      if (es.length === 1 && only(es, "line") && !pts(sel).length) return { type: "vertical", entity: es[0].id };
      const p = pts(sel);
      return p.length === 2 && !es.length ? { type: "vertical", points: p } : null;
    },
  },
  {
    label: "Coincident",
    build: (s, sel) => (pts(sel).length === 2 && !entities(s, sel).length ? { type: "coincident", points: pts(sel) } : null),
  },
  {
    label: "Fixed",
    build: (s, sel) => (pts(sel).length === 1 && !entities(s, sel).length ? { type: "fixed", point: pts(sel)[0] } : null),
  },
  {
    label: "Parallel",
    build: (s, sel) => {
      const es = entities(s, sel);
      return es.length === 2 && only(es, "line") && !pts(sel).length ? { type: "parallel", entities: es.map((e) => e.id) } : null;
    },
  },
  {
    label: "Perpendicular",
    build: (s, sel) => {
      const es = entities(s, sel);
      return es.length === 2 && only(es, "line") && !pts(sel).length ? { type: "perpendicular", entities: es.map((e) => e.id) } : null;
    },
  },
  {
    label: "Equal",
    build: (s, sel) => {
      const es = entities(s, sel);
      if (es.length !== 2 || pts(sel).length) return null;
      const lines = es.filter((e) => e.type === "line").length;
      return lines === 2 || lines === 0 ? { type: "equal", entities: es.map((e) => e.id) } : null;
    },
  },
  {
    label: "Tangent",
    build: (s, sel) => {
      const es = entities(s, sel);
      if (es.length !== 2 || pts(sel).length) return null;
      const round = es.filter((e) => e.type === "arc" || e.type === "circle").length;
      const lines = es.filter((e) => e.type === "line").length;
      return (round === 1 && lines === 1) || round === 2 ? { type: "tangent", entities: es.map((e) => e.id) } : null;
    },
  },
  {
    label: "Point on",
    build: (s, sel) => {
      const es = entities(s, sel);
      return es.length === 1 && pts(sel).length === 1 ? { type: "point_on", point: pts(sel)[0], entity: es[0].id } : null;
    },
  },
  {
    label: "Midpoint",
    build: (s, sel) => {
      const es = entities(s, sel);
      return es.length === 1 && only(es, "line") && pts(sel).length === 1 ? { type: "midpoint", point: pts(sel)[0], entity: es[0].id } : null;
    },
  },
  {
    label: "Symmetric",
    build: (s, sel) => {
      const es = entities(s, sel);
      return es.length === 1 && only(es, "line") && pts(sel).length === 2 ? { type: "symmetric", points: pts(sel), entity: es[0].id } : null;
    },
  },
  {
    label: "Length / distance",
    dimension: true,
    build: (s, sel) => {
      const es = entities(s, sel);
      if (es.length === 1 && only(es, "line") && !pts(sel).length) return { type: "distance", entity: es[0].id };
      return pts(sel).length === 2 && !es.length ? { type: "distance", points: pts(sel) } : null;
    },
    initial: (s, sel) => {
      const es = entities(s, sel);
      const line = es[0];
      return line && line.type === "line" ? dist(s, line.a, line.b) : dist(s, pts(sel)[0], pts(sel)[1]);
    },
  },
  {
    label: "Horizontal distance",
    dimension: true,
    build: (s, sel) => {
      const es = entities(s, sel);
      if (es.length === 1 && only(es, "line") && !pts(sel).length) return { type: "horizontal_distance", entity: es[0].id };
      return pts(sel).length === 2 && !es.length ? { type: "horizontal_distance", points: pts(sel) } : null;
    },
    initial: (s, sel) => {
      const [a, b] = ends(s, sel);
      return Math.abs(pointOf(s, a).u - pointOf(s, b).u);
    },
  },
  {
    label: "Vertical distance",
    dimension: true,
    build: (s, sel) => {
      const es = entities(s, sel);
      if (es.length === 1 && only(es, "line") && !pts(sel).length) return { type: "vertical_distance", entity: es[0].id };
      return pts(sel).length === 2 && !es.length ? { type: "vertical_distance", points: pts(sel) } : null;
    },
    initial: (s, sel) => {
      const [a, b] = ends(s, sel);
      return Math.abs(pointOf(s, a).v - pointOf(s, b).v);
    },
  },
  {
    label: "Radius",
    dimension: true,
    build: (s, sel) => {
      const es = entities(s, sel);
      return es.length === 1 && only(es, "circle", "arc") && !pts(sel).length ? { type: "radius", entity: es[0].id } : null;
    },
    initial: (s, sel) => radiusOf(s, entities(s, sel)[0]),
  },
  {
    label: "Diameter",
    dimension: true,
    build: (s, sel) => {
      const es = entities(s, sel);
      return es.length === 1 && only(es, "circle", "arc") && !pts(sel).length ? { type: "diameter", entity: es[0].id } : null;
    },
    initial: (s, sel) => 2 * radiusOf(s, entities(s, sel)[0]),
  },
  {
    label: "Angle",
    dimension: true,
    build: (s, sel) => {
      const es = entities(s, sel);
      return es.length === 2 && only(es, "line") && !pts(sel).length ? { type: "angle", entities: es.map((e) => e.id) } : null;
    },
    initial: (s, sel) => {
      const [a, b] = entities(s, sel) as Extract<SketchEntity, { type: "line" }>[];
      const d = (l: typeof a) => [pointOf(s, l.b).u - pointOf(s, l.a).u, pointOf(s, l.b).v - pointOf(s, l.a).v];
      const [da, db] = [d(a), d(b)];
      const angle = (Math.acos((da[0] * db[0] + da[1] * db[1]) / Math.hypot(...da) / Math.hypot(...db)) * 180) / Math.PI;
      return Math.round(angle * 1000) / 1000;
    },
  },
];

/** Constraint options that fit a selection. */
export function optionsFor(s: SketchData, sel: SketchSel[]): ConstraintOption[] {
  return sel.length === 0 ? [] : CONSTRAINT_OPTIONS.filter((o) => o.build(s, sel) !== null);
}

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
    distance: "Distance",
    horizontal_distance: "Horizontal distance",
    vertical_distance: "Vertical distance",
    radius: "Radius",
    diameter: "Diameter",
    angle: "Angle",
  };
  const refs = [...(c.points ?? []).map((p) => `p${p}`), ...(c.point !== undefined ? [`p${c.point}`] : []), ...(c.entity !== undefined ? [`#${c.entity}`] : []), ...(c.entities ?? []).map((e) => `#${e}`)];
  void s;
  return `${names[c.type] ?? c.type} ${refs.join(" ")}${c.value !== undefined ? ` = ${parseFloat(c.value.toFixed(3))}` : ""}`;
}

/** Dimension annotations (drawn by DimensionOverlay) for the sketch's dimensional constraints. */
export function dimensionsOf(s: SketchData): Dimension[] {
  const f = frame(s.plane);
  const out: Dimension[] = [];
  const world = (id: number) => toWorld(s.plane, pointOf(s, id).u, pointOf(s, id).v);
  for (const c of s.constraints) {
    if (c.value === undefined) continue;
    const text = parseFloat(c.value.toFixed(3)).toString();
    const entity = s.entities.find((e) => e.id === c.entity);
    if (c.type === "distance") {
      const ends = entity && entity.type === "line" ? [entity.a, entity.b] : c.points!;
      const [a, b] = [world(ends[0]), world(ends[1])];
      const along = norm(sub(b, a));
      out.push({ kind: "linear", text, points: [a, b], offsetDirection: cross(f.n, along) });
    } else if ((c.type === "horizontal_distance" || c.type === "vertical_distance") && true) {
      const horizontal = c.type === "horizontal_distance";
      const ids = entity && entity.type === "line" ? [entity.a, entity.b] : c.points!;
      const [pa, pb] = [pointOf(s, ids[0]), pointOf(s, ids[1])];
      const a = world(ids[0]);
      const corner = toWorld(s.plane, horizontal ? pb.u : pa.u, horizontal ? pa.v : pb.v);
      const side = horizontal ? f.y : f.x;
      // The dimension runs along the projected leg (a to corner) and sits on the side away from the other point.
      const away = horizontal ? (pb.v >= pa.v ? -1 : 1) : pb.u >= pa.u ? -1 : 1;
      out.push({ kind: "linear", text, points: [a, corner], offsetDirection: side.map((x) => x * away) });
    } else if ((c.type === "radius" || c.type === "diameter") && entity && entity.type !== "line") {
      const center = world(entity.center);
      const r = radiusOf(s, entity);
      const rim = entity.type === "circle" ? [0, 1, 2].map((k) => center[k] + r * f.x[k]) : world(entity.start);
      if (c.type === "radius") out.push({ kind: "radius", text: `R${text}`, points: [center, rim] });
      else out.push({ kind: "diameter", text: `⌀${text}`, points: [[0, 1, 2].map((k) => 2 * center[k] - rim[k]), rim] });
    }
  }
  return out;
}

/** Polyline of an entity in sketch coordinates (circles and arcs sampled), for drawing and picking. */
export function polyline(s: SketchData, e: SketchEntity, segments = 48): [number, number][] {
  if (e.type === "line") return [[pointOf(s, e.a).u, pointOf(s, e.a).v], [pointOf(s, e.b).u, pointOf(s, e.b).v]];
  const c = pointOf(s, e.center);
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
    } else {
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
    if (e.type === "line") continue;
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
 * The principal axes that lie in a sketch plane, as lines in sketch coordinates (a point and a direction).
 * An axis lies in the plane when it is square to the plane's normal and the origin is on the plane.
 */
export function axisLines(plane: PlaneData): { u: number; v: number; du: number; dv: number }[] {
  const f = frame(plane);
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (Math.abs(dot(f.origin, f.n)) > 1e-6) return [];
  const [u, v] = toPlane(plane, [0, 0, 0]);
  const lines = [];
  for (const d of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
    if (Math.abs(dot(f.n, d)) > 1e-9) continue;
    lines.push({ u, v, du: dot(d, f.x), dv: dot(d, f.y) });
  }
  return lines;
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
