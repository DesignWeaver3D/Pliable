/** What the drawing tools do to the sketch: each takes the clicked points and adds points, curves and constraints.
 *  Moved out of sketch.ts; `SketchMode` passes itself as the context. The geometry itself is in sketchshapes.ts. */
import * as M from "./sketchmodel.ts";
import * as Sh from "./sketchshapes.ts";
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
  addConstraintRaw(c: Omit<M.SketchConstraint, "id">, kind?: "snap" | "shape"): void;
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

/** Corner to corner, or (centred) from the centre to a corner; optional rounded or bevelled corners. */
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
  ctx.resolve();
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
  // Equal sides keep it regular when a corner is dragged; the corners stay free.
  ids.slice(1).forEach((id) => ctx.addConstraintRaw({ type: "equal", entities: [ids[0], id] }));
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
  const a = Math.hypot(major.u - center.u, major.v - center.v);
  if (a < 1e-6) return;
  // the short radius is how far the third click is from the long axis
  const minor = Math.abs(((side.u - center.u) * (major.v - center.v) - (side.v - center.v) * (major.u - center.u)) / a);
  if (minor < 1e-6) return;
  ctx.pushUndo();
  const c = ctx.pointFor(center);
  const m = ctx.pointFor(major);
  ctx.s.entities.push({ id: M.nextId(ctx.s), type: "ellipse", center: c, major: m, minor });
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

/** Two end centres and a width: two straight edges and two half-circle ends that stay tangent and equal. */
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

export function addArc(ctx: BuilderContext, center: Snap, start: Snap, end: Snap) {
  const radius = Math.hypot(start.u - center.u, start.v - center.v);
  if (radius < 1e-6) return;
  ctx.pushUndo();
  const angle = Math.atan2(end.v - center.v, end.u - center.u);
  const c = ctx.pointFor(center);
  const s = ctx.pointFor(start);
  const e = ctx.pointFor({ u: center.u + radius * Math.cos(angle), v: center.v + radius * Math.sin(angle) });
  const arcId = M.nextId(ctx.s);
  ctx.s.entities.push({ id: arcId, type: "arc", center: c, start: s, end: e });
  // An arc that starts on the end of a line, with its centre square to the line there, continues it tangentially.
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
