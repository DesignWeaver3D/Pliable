/** The sketch's data types and the plane math every sketch module builds on: points, curves, constraints, the plane frame and the built-in axes. Imports no other sketch module, so any of them may import this one. */
import { cross3, dot3, sub3, unit3, type Vec3 } from "./vec.ts";

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
  | { id: number; type: "line"; a: number; b: number; construction?: boolean; reference?: boolean; axis?: boolean }
  | { id: number; type: "circle"; center: number; radius: number; construction?: boolean; reference?: boolean }
  | { id: number; type: "arc"; center: number; start: number; end: number; construction?: boolean; reference?: boolean }
  /** Center, the ends of the major axis (`major`, `major2`) and of the minor axis (`minor1`, `minor2`, four points the solver keeps square about the center), and the minor radius
   *  (follows the minor ends). An older ellipse has only the center, `major` and `minor`. With `start` and `end` (points the solver keeps on the ellipse) it is an
   *  elliptical arc: the part counterclockwise from `start` to `end`. */
  | { id: number; type: "ellipse"; center: number; major: number; major2?: number; minor1?: number; minor2?: number; minor: number; start?: number; end?: number; construction?: boolean; reference?: boolean }
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
  /** Angle between two lines: the value is the outside angle (180 degrees minus the one between the line directions). */
  outside?: boolean;
  /** Added by a drawing tool rather than chosen by the user; shown as such and removable with one click. */
  auto?: boolean;
  /** Added when a point was clicked on a sketch axis; dropped first if the sketch cannot be solved with it (it can be redundant with a drawn horizontal or vertical side). */
  axisHold?: boolean;
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

export type { Vec3 };
const [sub, dot, cross, norm] = [sub3, dot3, cross3, unit3];

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
  const p = s.points.find((q) => q.id === id) ?? AXIS_POINTS.find((q) => q.id === id);
  if (!p) throw new Error(`no point ${id}`);
  return p;
}

/** The sketch's own horizontal (u) and vertical (v) axes, which can be picked and constrained to like lines. They are not stored in `entities`: they have these fixed ids below zero and are built on demand. */
export const AXIS_U = -1;
export const AXIS_V = -2;
const AXIS_REACH = 1e4;
export const AXIS_POINTS: SketchPoint[] = [
  { id: -11, u: -AXIS_REACH, v: 0, fixed: true },
  { id: -12, u: AXIS_REACH, v: 0, fixed: true },
  { id: -21, u: 0, v: -AXIS_REACH, fixed: true },
  { id: -22, u: 0, v: AXIS_REACH, fixed: true },
];
export const AXIS_LINES: SketchEntity[] = [
  { id: AXIS_U, type: "line", a: -11, b: -12, reference: true, axis: true },
  { id: AXIS_V, type: "line", a: -21, b: -22, reference: true, axis: true },
];

/** The entity with this id: a stored one, or one of the sketch's axes. */
export function entityOf(s: SketchData, id: number | undefined): SketchEntity | undefined {
  return s.entities.find((e) => e.id === id) ?? AXIS_LINES.find((e) => e.id === id);
}

export function nextId(s: SketchData): number {
  return 1 + Math.max(0, ...s.points.map((p) => p.id), ...s.entities.map((e) => e.id), ...s.constraints.map((c) => c.id));
}

/** Points an entity is made of (line ends; circle and arc: center first). */
export function entityPoints(e: SketchEntity): number[] {
  return e.type === "line" ? [e.a, e.b] : e.type === "circle" ? [e.center] : e.type === "ellipse" ? [e.center, e.major, ...(e.minor1 !== undefined ? [e.major2!, e.minor1, e.minor2!] : []), ...(e.start !== undefined ? [e.start, e.end!] : [])] : e.type === "spline" ? [...e.points] : [e.center, e.start, e.end];
}

/** Remove a point or entity with everything that depends on it; points no entity uses any more go too. */
export function remove(s: SketchData, sel: SketchSel): SketchData {
  let entities = s.entities;
  let constraints = s.constraints;
  const released = new Set<number>(); // points of the removed entities: only these can become orphans (a free point elsewhere stays, with its constraints)
  const dropEntity = (id: number) => {
    for (const e of entities.filter((e) => e.id === id)) entityPoints(e).forEach((p) => released.add(p));
    entities = entities.filter((e) => e.id !== id);
    constraints = constraints.filter((c) => c.entity !== id && !c.entities?.includes(id));
  };
  if (sel.kind === "entity") dropEntity(sel.id);
  else for (const e of entities.filter((e) => entityPoints(e).includes(sel.id))) dropEntity(e.id);
  if (sel.kind === "point") released.add(sel.id); // a free point that was selected goes too
  const used = new Set(entities.flatMap(entityPoints));
  const orphans = new Set(s.points.filter((p) => released.has(p.id) && !used.has(p.id)).map((p) => p.id));
  const refs = (c: SketchConstraint) => [...(c.points ?? []), ...(c.point !== undefined ? [c.point] : [])];
  constraints = constraints.filter((c) => !refs(c).some((id) => orphans.has(id)));
  return { ...s, entities, constraints, points: s.points.filter((p) => !orphans.has(p.id)) };
}
