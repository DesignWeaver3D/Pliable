/** Where a click in a sketch lands: the point or curve under the pointer, snapped to points, curves, midpoints, axes,
 *  the grid and guides, and what the select tool picks. Moved out of sketch.ts; `SketchMode` is the context. */
import type * as THREE from "three";
import * as M from "./sketchmodel.ts";
import { AUTO_AXIS_DEG } from "./sketchbuilders.ts";
import type { Snap, Tool, SketchOptions } from "./sketch.ts";

export const SNAP_PX = 10; // pointer snaps to an existing sketch point this close
export const PICK_PX = 8; // pick radius for points and curves in the select tool

/** The part of the sketch mode the snap and pick rules read. Nothing here is changed by them. */
export interface SnapContext {
  s: M.SketchData;
  chain: Snap[];
  tool: Tool;
  options: SketchOptions;
  /** The distance the pointer snaps to when snap to grid is on. */
  gridStep(): number;
  /** The sketch point under a pointer event on the plane (null when the ray misses the plane). */
  planeUV(e: PointerEvent): [number, number] | null;
  screenOf(u: number, v: number): THREE.Vector2;
  mousePx(e: PointerEvent): THREE.Vector2;
  /** Model units per screen pixel at a sketch position. */
  pixelAt(u: number, v: number): number;
}

export function nearestPoint(ctx: SnapContext, e: PointerEvent): M.SketchPoint | null {
  const m = ctx.mousePx(e);
  let best: M.SketchPoint | null = null;
  let bestD = SNAP_PX;
  for (const p of ctx.s.points) {
    const d = ctx.screenOf(p.u, p.v).distanceTo(m);
    // The sketch origin wins over a vertex sitting on it, so a new constraint can always reach the origin.
    const origin = p.fixed && Math.hypot(p.u, p.v) < 1e-6;
    if (d < bestD || (origin && best && d <= bestD + 0.5)) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

export function snap(ctx: SnapContext, e: PointerEvent): Snap | null {
  const near = nearestPoint(ctx, e);
  if (near) return { id: near.id, u: near.u, v: near.v };
  const uv = ctx.planeUV(e);
  if (!uv) return null;
  let [u, v] = uv;
  if (ctx.options.snapGrid) {
    const step = ctx.gridStep();
    [u, v] = [Math.round(u / step) * step, Math.round(v / step) * step];
  }
  let axis: Snap["axis"];
  const last = ctx.chain[ctx.chain.length - 1];
  if (ctx.tool === "line" && last) {
    const angle = (Math.atan2(v - last.v, u - last.u) * 180) / Math.PI;
    const fromH = Math.min(Math.abs(angle), Math.abs(Math.abs(angle) - 180));
    if (fromH < AUTO_AXIS_DEG) [v, axis] = [last.v, "h"];
    else if (Math.abs(Math.abs(angle) - 90) < AUTO_AXIS_DEG) [u, axis] = [last.u, "v"];
  }
  const pixel = ctx.pixelAt(u, v);
  const reach = SNAP_PX * pixel;
  if (ctx.tool === "line" && ctx.chain.length >= 1) {
    const t = M.tangentFrom(ctx.s, ctx.chain[ctx.chain.length - 1], u, v, reach);
    if (t) return { u: t.u, v: t.v, tangent: t.entity, on: { entity: t.entity } };
  }
  if (ctx.tool === "circle" && ctx.chain.length === 1) {
    const t = M.tangentRadius(ctx.s, ctx.chain[0], u, v, reach);
    if (t) return { u: t.u, v: t.v, tangent: t.entity };
  }
  // Midpoints of lines, then the nearest point on a curve.
  for (const en of ctx.s.entities) {
    if (en.type !== "line") continue;
    const a = M.pointOf(ctx.s, en.a);
    const b = M.pointOf(ctx.s, en.b);
    const mid = [(a.u + b.u) / 2, (a.v + b.v) / 2];
    if (Math.hypot(u - mid[0], v - mid[1]) < reach) return { u: mid[0], v: mid[1], on: { entity: en.id, midpoint: true } };
  }
  for (const en of ctx.s.entities) {
    if (M.distanceTo(ctx.s, en, u, v) < reach) {
      const on = M.closestOn(ctx.s, en, u, v);
      if (on) return { u: on[0], v: on[1], on: { entity: en.id } };
    }
  }
  // The sketch's own axes, through the centre of the face (its origin).
  for (const a of M.sketchAxes(ctx.s.plane)) {
    const t = (u - a.u) * a.du + (v - a.v) * a.dv;
    const on: [number, number] = [a.u + t * a.du, a.v + t * a.dv];
    if (Math.hypot(u - on[0], v - on[1]) < reach) return { u: on[0], v: on[1] };
  }
  // Line up with the u or v of an existing point and show a guide to it.
  if (!axis) {
    let [su, sv] = [u, v];
    const hit = ctx.s.points.find((p) => Math.abs(p.u - u) < reach);
    const level = ctx.s.points.find((p) => Math.abs(p.v - v) < reach);
    if (hit) su = hit.u;
    if (level) sv = level.v;
    const guides: [number, number][][] = [];
    if (hit) guides.push([[hit.u, hit.v], [su, sv]]);
    if (level) guides.push([[level.u, level.v], [su, sv]]);
    if (guides.length) return { u: su, v: sv, guides };
  }
  return { u, v, axis };
}

/**
 * Where a dragged point lands: the grid when snap to grid is on, then the sketch's axes, else lined up with the u or v of
 * another point (with guide lines to show it). It never snaps onto other points or curves, so a drag does not join things.
 */
export function snapDragged(ctx: Pick<SnapContext, "s" | "options" | "gridStep" | "pixelAt">, uv: [number, number], dragged: number[]): Snap {
  let [u, v] = uv;
  if (ctx.options.snapGrid) {
    const step = ctx.gridStep();
    [u, v] = [Math.round(u / step) * step, Math.round(v / step) * step];
  }
  const reach = SNAP_PX * ctx.pixelAt(u, v);
  for (const a of M.sketchAxes(ctx.s.plane)) {
    const t = (u - a.u) * a.du + (v - a.v) * a.dv;
    const on: [number, number] = [a.u + t * a.du, a.v + t * a.dv];
    if (Math.hypot(u - on[0], v - on[1]) < reach) return { u: on[0], v: on[1] };
  }
  const others = ctx.s.points.filter((p) => !dragged.includes(p.id));
  const hit = others.find((p) => Math.abs(p.u - u) < reach);
  const level = others.find((p) => Math.abs(p.v - v) < reach);
  const [su, sv] = [hit ? hit.u : u, level ? level.v : v];
  const guides: [number, number][][] = [];
  if (hit) guides.push([[hit.u, hit.v], [su, sv]]);
  if (level) guides.push([[level.u, level.v], [su, sv]]);
  return guides.length ? { u: su, v: sv, guides } : { u, v };
}

export function pick(ctx: SnapContext, e: PointerEvent): M.SketchSel | null {
  const point = nearestPoint(ctx, e);
  if (point) return { kind: "point", id: point.id };
  const uv = ctx.planeUV(e);
  if (!uv) return null;
  const pixel = ctx.pixelAt(uv[0], uv[1]);
  let best: M.SketchSel | null = null;
  let bestD = PICK_PX * pixel;
  for (const en of ctx.s.entities) {
    const d = M.distanceTo(ctx.s, en, uv[0], uv[1]);
    if (d < bestD) {
      best = { kind: "entity", id: en.id };
      bestD = d;
    }
  }
  if (best) return best;
  // The sketch's axes can be picked too (to dimension or constrain to), but any other curve or point nearby wins.
  for (const [i, a] of M.sketchAxes(ctx.s.plane).entries()) {
    const d = Math.abs((uv[0] - a.u) * -a.dv + (uv[1] - a.v) * a.du);
    if (d < bestD) {
      best = { kind: "entity", id: -1 - i };
      bestD = d;
    }
  }
  return best;
}
