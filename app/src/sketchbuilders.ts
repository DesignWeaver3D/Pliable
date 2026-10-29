/** What the drawing tools do to the sketch: each takes the clicked points and adds points, curves and constraints.
 *  Moved out of sketch.ts; `SketchMode` passes itself as the context. The geometry itself is in sketchshapes.ts. */
import * as M from "./sketchmodel.ts";
import * as Sh from "./sketchshapes.ts";
import * as Ell from "./sketchellipse.ts";
import type { Drag, Snap } from "./sketch.ts";

/** A line drawn within this angle of horizontal/vertical becomes exactly so (also read by the arc tangent rule below). */
export const AUTO_AXIS_DEG = 3;

/** The part of the sketch mode the drawing tools use. */
export interface BuilderContext {
  /** The current sketch, read live: undo replaces it. */
  s: M.SketchData;
  /** Points clicked so far for the current drawing. */
  chain: Snap[];
  /** Where the current line chain started (a line that ends there closes the outline). */
  chainStart?: Snap;
  rectOptions: { corner: "none" | "fillet" | "chamfer"; size: number };
  pushUndo(): void;
  resolve(drag?: Drag): Promise<boolean>;
  /** The id of an existing or new point for a clicked position. */
  pointFor(snap: Snap): number;
  /** "always" constraints are added whatever the automatic-constraints option says (the center rectangle's center point). */
  addConstraintRaw(c: Omit<M.SketchConstraint, "id">, kind?: "snap" | "shape" | "always"): void;
  status(text: string, error?: boolean | "warn"): void;
}

/** Returns true if the line ended on the first point of the chain (a closed outline). */
export function addLine(ctx: BuilderContext, a: Snap, b: Snap): boolean {
  ctx.pushUndo();
  const first = ctx.chainStart;
  if (!ctx.chainStart) ctx.chainStart = a;
  const ia = ctx.pointFor(a);
  const ib = ctx.pointFor(b);
  if (ia === ib) return false;
  const id = M.nextId(ctx.s);
  ctx.s.entities.push({ id, type: "line", a: ia, b: ib });
  if (b.tangent !== undefined) ctx.addConstraintRaw({ type: "tangent", entities: [id, b.tangent] }, "snap");
  if (b.axis === "h") ctx.addConstraintRaw({ type: "horizontal", entity: id }, "snap");
  if (b.axis === "v") ctx.addConstraintRaw({ type: "vertical", entity: id }, "snap");
  ctx.resolve();
  const closed = first !== undefined && first.id === ib && first !== a;
  if (closed) ctx.chainStart = undefined;
  return closed;
}

/** Corner to corner, or (centered) from the center to a corner; optional rounded or bevelled corners. */
export function addRectangle(ctx: BuilderContext, a: Snap, b: Snap, centred = false) {
  const [u0, u1] = centred ? [2 * a.u - b.u, b.u].sort((x, y) => x - y) : [a.u, b.u].sort((x, y) => x - y);
  const [v0, v1] = centred ? [2 * a.v - b.v, b.v].sort((x, y) => x - y) : [a.v, b.v].sort((x, y) => x - y);
  if (u1 - u0 < 1e-6 || v1 - v0 < 1e-6) return;
  ctx.pushUndo();
  const { corner } = ctx.rectOptions;
  const size = Math.min(ctx.rectOptions.size, (Math.min(u1 - u0, v1 - v0) / 2) * 0.999);
  if (corner === "none" || size < 1e-6) {
    // Snapped corners (existing points) stay in use; the other two are new.
    const corners: Snap[] = [{ u: u0, v: v0 }, { u: u1, v: v0 }, { u: u1, v: v1 }, { u: u0, v: v1 }].map((c) => (!centred ? [a, b].find((o) => o.id !== undefined && o.u === c.u && o.v === c.v) : undefined) ?? c);
    const p = corners.map((c) => ctx.pointFor(c));
    const ids = p.map((_, k) => addLineBetween(ctx, p[k], p[(k + 1) % 4]));
    ids.forEach((id, k) => ctx.addConstraintRaw({ type: k % 2 === 0 ? "horizontal" : "vertical", entity: id }));
    if (centred) addCentrePoint(ctx, a, p[0], p[2]);
    ctx.resolve();
    return;
  }
  // Going counterclockwise: each side runs between its two trimmed ends, each corner is an arc or a bevel.
  const r = size;
  const side = (u: number, v: number) => ctx.pointFor({ u, v } as Snap);
  const ends: [number, number][][] = [
    [[u0 + r, v0], [u1 - r, v0]],
    [[u1, v0 + r], [u1, v1 - r]],
    [[u1 - r, v1], [u0 + r, v1]],
    [[u0, v1 - r], [u0, v0 + r]],
  ];
  const pts = ends.map((e) => e.map(([u, v]) => side(u, v)));
  const centres: [number, number][] = [[u1 - r, v0 + r], [u1 - r, v1 - r], [u0 + r, v1 - r], [u0 + r, v0 + r]];
  const sides = pts.map(([from, to]) => addLineBetween(ctx, from, to));
  sides.forEach((id, k) => ctx.addConstraintRaw({ type: k % 2 === 0 ? "horizontal" : "vertical", entity: id }));
  for (let k = 0; k < 4; k++) {
    const start = pts[k][1];
    const end = pts[(k + 1) % 4][0];
    if (corner === "chamfer") {
      addLineBetween(ctx, start, end);
      continue;
    }
    const centre = ctx.pointFor({ u: centres[k][0], v: centres[k][1] } as Snap);
    const arc = M.nextId(ctx.s);
    ctx.s.entities.push({ id: arc, type: "arc", center: centre, start, end });
    ctx.addConstraintRaw({ type: "tangent", entities: [arc, sides[k]] });
    ctx.addConstraintRaw({ type: "tangent", entities: [arc, sides[(k + 1) % 4]] });
  }
  if (centred) addCentrePoint(ctx, a, pts[0][0], pts[2][0]);
  ctx.resolve();
}

/**
 * The center of a rectangle drawn from its center is a point of its own, held halfway between two opposite corners (symmetric about it).
 * If it was clicked on a point it is that point; if on a curve or a sketch axis it is also made coincident with it. These constraints are
 * always made, whatever the automatic-constraints option says (owner, 2026-10-25).
 */
function addCentrePoint(ctx: BuilderContext, centre: Snap, cornerA: number, cornerB: number) {
  const clickedOnPoint = centre.id !== undefined;
  const id = ctx.pointFor(centre);
  const has = (type: string) => ctx.s.constraints.some((c) => c.type === type && c.point === id);
  if (!clickedOnPoint) {
    if (centre.on) {
      if (!has(centre.on.midpoint ? "midpoint" : "point_on")) ctx.addConstraintRaw(centre.on.midpoint ? { type: "midpoint", point: id, entity: centre.on.entity } : { type: "point_on", point: id, entity: centre.on.entity }, "always");
    } else {
      const axis = M.sketchAxes(ctx.s.plane).findIndex((x) => Math.abs((centre.u - x.u) * -x.dv + (centre.v - x.v) * x.du) < 1e-9);
      if (axis >= 0) ctx.addConstraintRaw({ type: "point_on", point: id, entity: axis === 0 ? M.AXIS_U : M.AXIS_V }, "always");
    }
  }
  ctx.addConstraintRaw({ type: "symmetric_point", points: [cornerA, cornerB], point: id }, "always");
}

export function addLineBetween(ctx: BuilderContext, a: number, b: number): number {
  const id = M.nextId(ctx.s);
  ctx.s.entities.push({ id, type: "line", a, b });
  return id;
}

export function polygonCorners(center: { u: number; v: number }, corner: { u: number; v: number }, sides: number): { u: number; v: number }[] {
  const radius = Math.hypot(corner.u - center.u, corner.v - center.v);
  const start = Math.atan2(corner.v - center.v, corner.u - center.u);
  return Array.from({ length: sides }, (_, k) => ({
    u: center.u + radius * Math.cos(start + (2 * Math.PI * k) / sides),
    v: center.v + radius * Math.sin(start + (2 * Math.PI * k) / sides),
  }));
}

export function addPolygon(ctx: BuilderContext, center: Snap, corner: Snap, sides: number) {
  if (Math.hypot(corner.u - center.u, corner.v - center.v) < 1e-6) return;
  ctx.pushUndo();
  const p = polygonCorners(center, corner, sides).map((c) => ctx.pointFor(c as Snap));
  const ids = p.map((_, k) => {
    const id = M.nextId(ctx.s);
    ctx.s.entities.push({ id, type: "line", a: p[k], b: p[(k + 1) % sides] });
    return id;
  });
  // What makes it a regular polygon (always added, whatever the automatic constraint option): equal sides, every corner on a
  // construction circle about the center (the major circle), and a second construction circle (the minor one) tangent to a
  // side. Dimension a side, or either circle, and the whole polygon follows. The circles show only while the sketch is edited.
  const centre = ctx.pointFor(center);
  const radius = Math.hypot(corner.u - center.u, corner.v - center.v);
  const major = M.nextId(ctx.s);
  ctx.s.entities.push({ id: major, type: "circle", center: centre, radius, construction: true });
  const minor = M.nextId(ctx.s);
  ctx.s.entities.push({ id: minor, type: "circle", center: centre, radius: radius * Math.cos(Math.PI / sides), construction: true });
  const add = (c: Omit<M.SketchConstraint, "id">) => ctx.s.constraints.push({ id: M.nextId(ctx.s), ...c, auto: true });
  ids.slice(1).forEach((id) => add({ type: "equal", entities: [ids[0], id] }));
  p.forEach((point) => add({ type: "point_on", point, entity: major }));
  add({ type: "tangent", entities: [minor, ids[0]] });
  ctx.resolve();
}

export function addCircle(ctx: BuilderContext, center: Snap, edge: Snap) {
  const radius = Math.hypot(edge.u - center.u, edge.v - center.v);
  if (radius < 1e-6) return;
  ctx.pushUndo();
  const c = ctx.pointFor(center);
  const id = M.nextId(ctx.s);
  ctx.s.entities.push({ id, type: "circle", center: c, radius });
  if (edge.tangent !== undefined) ctx.addConstraintRaw({ type: "tangent", entities: [id, edge.tangent] }, "snap");
  ctx.resolve();
}

export function addEllipse(ctx: BuilderContext, center: Snap, major: Snap, side: Snap) {
  if (shortRadius(center, major, side) === null) return;
  ctx.pushUndo();
  makeEllipse(ctx, center, major, side);
  ctx.resolve();
}

/** The short radius of the ellipse of three clicks (how far the third is from the long axis), or null when the clicks give it no size. */
function shortRadius(center: Sh.UV, major: Sh.UV, side: Sh.UV): number | null {
  const a = Math.hypot(major.u - center.u, major.v - center.v);
  if (a < 1e-6) return null;
  const minor = Math.abs(((side.u - center.u) * (major.v - center.v) - (side.v - center.v) * (major.u - center.u)) / a);
  return minor < 1e-6 ? null : minor;
}

/** Push an ellipse with its four axis ends and the two construction lines along its axes; the ellipse. */
function makeEllipse(ctx: BuilderContext, center: Snap, major: Snap, side: Snap): Extract<M.SketchEntity, { type: "ellipse" }> {
  const a = Math.hypot(major.u - center.u, major.v - center.v);
  const minor = shortRadius(center, major, side)!;
  const c = ctx.pointFor(center);
  const m = ctx.pointFor(major);
  // the other three ends of the axes are points of their own, so they can be dimensioned and constrained to; the third click's side takes the minor end
  const side1 = ((side.u - center.u) * (major.v - center.v) - (side.v - center.v) * (major.u - center.u)) / a > 0 ? -1 : 1;
  const [nu, nv] = [(-(major.v - center.v) / a) * minor * side1, ((major.u - center.u) / a) * minor * side1];
  const end = (u: number, v: number) => ctx.pointFor({ u, v } as Snap);
  const major2 = end(2 * center.u - major.u, 2 * center.v - major.v);
  const minor1 = end(center.u + nu, center.v + nv);
  const minor2 = end(center.u - nu, center.v - nv);
  const entity: Extract<M.SketchEntity, { type: "ellipse" }> = { id: M.nextId(ctx.s), type: "ellipse", center: c, major: m, major2, minor1, minor2, minor };
  ctx.s.entities.push(entity);
  // Each axis is also a construction line between its two ends, so its length can be dimensioned by selecting the line alone.
  ctx.s.entities.push({ id: M.nextId(ctx.s), type: "line", a: m, b: major2, construction: true });
  ctx.s.entities.push({ id: M.nextId(ctx.s), type: "line", a: minor1, b: minor2, construction: true });
  return entity;
}

/** An elliptical arc: the ellipse of the first three clicks (center, long axis end, a point for the short radius) and the part of it between the
 *  start and end clicks, which are taken to the ellipse by angle. It follows the pointer from the start like an arc; `counterclockwise` forces the direction. */
export function addEllipseArc(ctx: BuilderContext, center: Snap, major: Snap, side: Snap, start: Snap, end: Snap, counterclockwise = false) {
  const minor = shortRadius(center, major, side);
  if (minor === null) return;
  ctx.pushUndo();
  const made = makeEllipse(ctx, center, major, side);
  const f = Ell.ellipseFrame(center, major, minor);
  const [t0, t1] = [Ell.ellipseAngle(f, start.u, start.v), Ell.ellipseAngle(f, end.u, end.v)];
  const clockwise = !counterclockwise && Ell.ellipseSweepToward(t0, t1) < 0; // arcs are stored counterclockwise
  const [first, last] = clockwise ? [t1, t0] : [t0, t1];
  const ends = [made.major, made.major2!, made.minor1!, made.minor2!];
  const at = (t: number, clicked: Snap) => {
    const [u, v] = Ell.ellipsePoint(f, t);
    if (clicked.id !== undefined && Math.hypot(clicked.u - u, clicked.v - v) < 1e-6) return clicked.id; // a point already on the ellipse is the end
    const axisEnd = ends.find((id) => Math.hypot(M.pointOf(ctx.s, id).u - u, M.pointOf(ctx.s, id).v - v) < 1e-6); // an end of an axis is the end
    return axisEnd ?? ctx.pointFor({ u, v } as Snap);
  };
  made.start = clockwise ? at(first, end) : at(first, start);
  made.end = clockwise ? at(last, start) : at(last, end);
  ctx.resolve();
}

/** The clicked points become a spline through them; a closed one joins the last back to the first. */
export function addSpline(ctx: BuilderContext, closed: boolean) {
  ctx.pushUndo();
  const ids: number[] = [];
  for (const snap of ctx.chain) {
    const id = ctx.pointFor(snap);
    if (ids[ids.length - 1] !== id) ids.push(id);
  }
  if (ids.length < 2) return;
  ctx.s.entities.push({ id: M.nextId(ctx.s), type: "spline", points: ids, ...(closed && ids.length > 2 ? { closed: true } : {}) });
  ctx.chain = [];
  ctx.resolve();
}

export function addArcThrough(ctx: BuilderContext, start: Snap, through: Snap, end: Snap) {
  const arc = Sh.arcThrough(start, through, end);
  if (!arc) return ctx.status("Those three points are in a line, so no arc passes through them", true);
  ctx.pushUndo();
  const [first, last] = arc.from === "start" ? [start, end] : [end, start];
  const centre = ctx.pointFor({ u: arc.centre.u, v: arc.centre.v } as Snap);
  const a = ctx.pointFor(first);
  const b = ctx.pointFor(last);
  ctx.s.entities.push({ id: M.nextId(ctx.s), type: "arc", center: centre, start: a, end: b });
  ctx.resolve();
}

export function addCircleThrough(ctx: BuilderContext, a: Snap, b: Snap, c: Snap) {
  const circle = Sh.circumcircle(a, b, c);
  if (!circle) return ctx.status("Those three points are in a line, so no circle passes through them", true);
  ctx.pushUndo();
  const centre = ctx.pointFor({ u: circle.u, v: circle.v } as Snap);
  const id = M.nextId(ctx.s);
  ctx.s.entities.push({ id, type: "circle", center: centre, radius: circle.radius });
  for (const snap of [a, b, c]) if (snap.id !== undefined) ctx.addConstraintRaw({ type: "point_on", point: snap.id, entity: id }, "snap"); // existing points stay on it
  ctx.resolve();
}

/** Two end centers and a width: two straight edges and two half-circle ends that stay tangent and equal. */
export function addSlot(ctx: BuilderContext, a: Snap, b: Snap, side: Snap) {
  const corners = Sh.slotCorners(a, b, Sh.distanceToAxis(a, b, side));
  if (!corners) return;
  ctx.pushUndo();
  const [ca, cb] = [ctx.pointFor(a), ctx.pointFor(b)];
  const at = (p: Sh.UV) => ctx.pointFor({ u: p.u, v: p.v } as Snap);
  const [aLeft, aRight, bLeft, bRight] = [corners.aLeft, corners.aRight, corners.bLeft, corners.bRight].map(at);
  const top = addLineBetween(ctx, aLeft, bLeft);
  const bottom = addLineBetween(ctx, bRight, aRight);
  // Both ends run counterclockwise: the far end from its right corner to its left, the near end back round.
  const endB = M.nextId(ctx.s);
  ctx.s.entities.push({ id: endB, type: "arc", center: cb, start: bRight, end: bLeft });
  const endA = M.nextId(ctx.s);
  ctx.s.entities.push({ id: endA, type: "arc", center: ca, start: aLeft, end: aRight });
  for (const [arc, line] of [[endB, top], [endB, bottom], [endA, top], [endA, bottom]]) ctx.addConstraintRaw({ type: "tangent", entities: [arc, line] });
  ctx.addConstraintRaw({ type: "equal", entities: [endA, endB] });
  ctx.resolve();
}

/** `counterclockwise` forces the direction (typed sweeps are always counterclockwise); otherwise the arc follows the pointer from the start. */
export function addArc(ctx: BuilderContext, center: Snap, start: Snap, end: Snap, counterclockwise = false) {
  const radius = Math.hypot(start.u - center.u, start.v - center.v);
  if (radius < 1e-6) return;
  ctx.pushUndo();
  const angle = Math.atan2(end.v - center.v, end.u - center.u);
  const c = ctx.pointFor(center);
  const s = ctx.pointFor(start);
  const e = ctx.pointFor({ u: center.u + radius * Math.cos(angle), v: center.v + radius * Math.sin(angle) });
  const arcId = M.nextId(ctx.s);
  const clockwise = !counterclockwise && Sh.arcSweepToward(center, start, end) < 0; // arcs are stored counterclockwise, so a clockwise one runs from the pointer's end back to the start
  ctx.s.entities.push({ id: arcId, type: "arc", center: c, start: clockwise ? e : s, end: clockwise ? s : e });
  // An arc that starts on the end of a line, with its center square to the line there, continues it tangentially.
  const meets = ctx.s.entities.find((x) => x.type === "line" && !x.reference && (x.a === s || x.b === s));
  if (meets && meets.type === "line") {
    const other = M.pointOf(ctx.s, meets.a === s ? meets.b : meets.a);
    const at = M.pointOf(ctx.s, s);
    const [lu, lv] = [at.u - other.u, at.v - other.v];
    const [cu, cv] = [center.u - at.u, center.v - at.v];
    const cosine = Math.abs(lu * cu + lv * cv) / (Math.hypot(lu, lv) * Math.hypot(cu, cv) || 1);
    if (cosine < Math.sin((AUTO_AXIS_DEG * 2 * Math.PI) / 180)) ctx.addConstraintRaw({ type: "tangent", entities: [arcId, meets.id] }, "snap");
  }
  ctx.resolve();
}
