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
}
export type SketchEntity =
  | { id: number; type: "line"; a: number; b: number; construction?: boolean }
  | { id: number; type: "circle"; center: number; radius: number; construction?: boolean }
  | { id: number; type: "arc"; center: number; start: number; end: number; construction?: boolean };
export interface SketchConstraint {
  id: number;
  type: string;
  points?: number[];
  point?: number;
  entity?: number;
  entities?: number[];
  value?: number;
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
  const orphans = new Set(s.points.filter((p) => !used.has(p.id)).map((p) => p.id));
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
      const arcs = es.filter((e) => e.type === "arc").length;
      const lines = es.filter((e) => e.type === "line").length;
      return (arcs === 1 && lines === 1) || arcs === 2 ? { type: "tangent", entities: es.map((e) => e.id) } : null;
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
