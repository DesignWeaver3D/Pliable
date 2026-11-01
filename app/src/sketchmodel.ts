/** Sketch data and the rules that need no DOM or WebGL: types, plane math, dimensions, trimming and snapping. Which constraints fit a selection lives in sketchconstraints.ts (re-exported here). */
import { pointInRect, polylineInBox, type Rect } from "./boxselect.ts";
import { crossings } from "./sketchintersect.ts";
export { crossings, crossingsWith } from "./sketchintersect.ts";
import { AXIS_LINES, AXIS_POINTS, entityPoints, nextId, pointOf } from "./sketchdata.ts";
import type { SketchConstraint, SketchData, SketchEntity, SketchPoint, SketchSel } from "./sketchdata.ts";
import { polyline } from "./sketchcurves.ts";
import { leaderAngle } from "./sketchleaderangle.ts";
export * from "./sketchdata.ts";
export * from "./sketchcurves.ts";
export * from "./sketchconstraints.ts";
export * from "./sketchsmartdim.ts";
export * from "./sketchannotate.ts";
export * from "./sketchaxes.ts";

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
 *  ones, with their new ends held on the old lines) and the arc or bevel. Returns the new sketch, or a message saying why the corner can't be changed.
 *  `at` is the pointer, which sets the way the fillet's radius leader goes when other dimensions share its center. */
export function roundCorner(s: SketchData, pointId: number, kind: "fillet" | "chamfer", size: number, at?: { u: number; v: number }): SketchData | string {
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
    constraints.push({ id: id++, type: "radius", entity: arc, value: size, angle: leaderAngle({ ...s, points: [...s.points, ...added], entities, constraints }, arc, "radius", at) }); // the fillet's radius, a driving dimension
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
