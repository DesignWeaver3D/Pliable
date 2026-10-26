/** What the sketch shows while a shape is being drawn: the rubber-band outline and the live size tag.
 *  Moved out of sketch.ts; `SketchMode` is the context. Read-only. */
import type { Dimension } from "./dimensions";
import * as B from "./sketchbuilders.ts";
import * as M from "./sketchmodel.ts";
import * as Ell from "./sketchellipse.ts";
import * as Sh from "./sketchshapes.ts";
import type { Snap, Tool } from "./sketch.ts";
import { arcByRadius, arcClick, radiusArcPoints, type ArcOptions } from "./sketcharcoptions.ts";
import { tangentArcFor, tangentArcPoints } from "./sketchtangentarc.ts";
import { typedLabels, typedTag } from "./sketchtyped.ts";
import { typedDimensions, typedPoint } from "./sketchtypeddims.ts";

export interface PreviewContext {
  s: M.SketchData;
  chain: Snap[];
  /** The snapped pointer position, with its guide lines. */
  cursor: Snap | null;
  tool: Tool;
  /** Text typed for an exact size, "" when none. */
  typed: string;
  arcOptions?: ArcOptions;
  sidesOf(tool: Tool): number | undefined;
}

export function liveDimensions(ctx: PreviewContext): Dimension[] {
  const c = ctx.cursor;
  const a = ctx.chain[ctx.chain.length - 1];
  if (!c || !a) return [];
  const n = (x: number) => parseFloat(x.toFixed(2)).toString();
  const tag = (u: number, v: number, text: string): Dimension[] => [{ kind: "tag", text, points: [M.toWorld(ctx.s.plane, u, v)], mark: true }];
  const du = c.u - a.u;
  const dv = c.v - a.v;
  if (ctx.typed) {
    // Typed sizes are drawn as real dimensions (extension lines, dimension lines, leaders) holding the typed values; the labelled tag is the fallback.
    const drawn = typedDimensions(ctx);
    return drawn.length ? drawn : tag((a.u + c.u) / 2, (a.v + c.v) / 2, typedTag(typedLabels(ctx.tool, ctx.chain.length, !!ctx.sidesOf(ctx.tool)), ctx.typed));
  }
  if (ctx.tool === "line") return tag((a.u + c.u) / 2, (a.v + c.v) / 2, `${n(Math.hypot(du, dv))} at ${n((Math.atan2(dv, du) * 180) / Math.PI)}°`);
  if (ctx.tool === "rectangle") return tag((a.u + c.u) / 2, c.v, `${n(Math.abs(du))} × ${n(Math.abs(dv))}`);
  if (ctx.tool === "rectcentre") return tag(a.u, c.v, `${n(Math.abs(du) * 2)} × ${n(Math.abs(dv) * 2)}`);
  if (ctx.tool === "circle") return tag((a.u + c.u) / 2, (a.v + c.v) / 2, `Ø${n(2 * Math.hypot(du, dv))}`);
  if (ctx.sidesOf(ctx.tool)) return tag((a.u + c.u) / 2, (a.v + c.v) / 2, `R${n(Math.hypot(du, dv))}`);
  return [];
}

/** Rubber-band shapes for the drawing in progress. */
export function pendingShapes(ctx: PreviewContext): [number, number][][] {
  // While sizes are typed the outline follows them, not the pointer.
  const typed = ctx.typed ? typedPoint(ctx) : null;
  const aimed = !typed && ctx.tool === "arc" && ctx.cursor && ctx.arcOptions && ctx.chain.length >= 1 && ctx.chain.length <= 2 ? arcClick(ctx.chain, ctx.cursor, ctx.arcOptions) : null;
  const shown: PreviewContext = typed ? Object.assign(Object.create(ctx), { cursor: { ...ctx.cursor, ...typed } }) : aimed ? Object.assign(Object.create(ctx), { cursor: { ...ctx.cursor, ...aimed } }) : ctx;
  return [...pendingBase(shown), ...(ctx.cursor?.guides ?? [])];
}
function pendingBase(ctx: PreviewContext): [number, number][][] {
  const c = ctx.cursor;
  const first = ctx.chain[0];
  if (!c || !first) return c?.guides ?? [];
  if (ctx.tool === "line") {
    const last = ctx.chain[ctx.chain.length - 1];
    return [[[last.u, last.v], [c.u, c.v]]];
  }
  if (ctx.tool === "rectangle") return [[[first.u, first.v], [c.u, first.v], [c.u, c.v], [first.u, c.v], [first.u, first.v]]];
  if (ctx.tool === "rectcentre") {
    const [x, y] = [2 * first.u - c.u, 2 * first.v - c.v];
    return [[[x, y], [c.u, y], [c.u, c.v], [x, c.v], [x, y]]];
  }
  const sides = ctx.sidesOf(ctx.tool);
  if (sides) {
    const corners = B.polygonCorners(first, c, sides).map((q) => [q.u, q.v] as [number, number]);
    return [[...corners, corners[0]]];
  }
  if (ctx.tool === "spline") {
    const through = [...ctx.chain, c];
    const probe: M.SketchData = { ...ctx.s, points: through.map((q, i) => ({ id: -1 - i, u: q.u, v: q.v })) };
    return [M.polyline(probe, { id: 0, type: "spline", points: through.map((_, i) => -1 - i) }, 48)];
  }
  if (ctx.tool === "ellipse") {
    const probe: M.SketchData = { ...ctx.s, points: [{ id: -1, u: first.u, v: first.v }, { id: -2, u: (ctx.chain[1] ?? c).u, v: (ctx.chain[1] ?? c).v }] };
    const a = Math.hypot(probe.points[1].u - first.u, probe.points[1].v - first.v);
    if (!ctx.chain[1] || a < 1e-9) return [[[first.u, first.v], [c.u, c.v]]];
    const minor = Math.abs(((c.u - first.u) * (probe.points[1].v - first.v) - (c.v - first.v) * (probe.points[1].u - first.u)) / a);
    return [M.polyline(probe, { id: 0, type: "ellipse", center: -1, major: -2, minor: Math.max(minor, 1e-6) }, 48)];
  }
  if (ctx.tool === "ellarc") {
    const second = ctx.chain[1];
    if (!second || Math.hypot(second.u - first.u, second.v - first.v) < 1e-9) return [[[first.u, first.v], [c.u, c.v]]];
    const side = ctx.chain[2] ?? c;
    const minor = Math.abs(((side.u - first.u) * (second.v - first.v) - (side.v - first.v) * (second.u - first.u)) / Math.hypot(second.u - first.u, second.v - first.v));
    const f = Ell.ellipseFrame(first, second, Math.max(minor, 1e-6));
    if (ctx.chain.length < 4) return [Ell.ellipseArcPoints(f, 0, 2 * Math.PI, 48)]; // the whole ellipse until the start is clicked
    const from = Ell.ellipseAngle(f, ctx.chain[3].u, ctx.chain[3].v);
    let sweep = Ell.ellipseSweepToward(from, Ell.ellipseAngle(f, c.u, c.v)); // follows the pointer: clockwise or counterclockwise from the start
    if (ctx.typed && sweep <= 0) sweep += 2 * Math.PI; // a typed sweep is always counterclockwise
    return [Ell.ellipseArcPoints(f, from, sweep, 48)];
  }
  if (ctx.tool === "arcrad") {
    const second = ctx.chain[1];
    if (!second) return [[[first.u, first.v], [c.u, c.v]]];
    const arc = arcByRadius(first, second, ctx.arcOptions?.radius ?? 0, c);
    return [arc ? radiusArcPoints(arc) : [[first.u, first.v], [second.u, second.v]]];
  }
  if (ctx.tool === "arctan") {
    const arc = tangentArcFor(ctx.s, first, c);
    return [arc ? tangentArcPoints(arc) : [[first.u, first.v], [c.u, c.v]]];
  }
  const second = ctx.chain[1];
  if (ctx.tool === "slot") {
    if (!second) return [[[first.u, first.v], [c.u, c.v]]];
    const corners = Sh.slotCorners(first, second, Sh.distanceToAxis(first, second, c));
    if (!corners) return [[[first.u, first.v], [second.u, second.v]]];
    const ring = (centre: Sh.UV, from: Sh.UV, to: Sh.UV): [number, number][] => {
      const [a0, a1] = [Math.atan2(from.v - centre.v, from.u - centre.u), Math.atan2(to.v - centre.v, to.u - centre.u)];
      const sweep = (a1 - a0 + 4 * Math.PI) % (2 * Math.PI);
      const radius = Math.hypot(from.u - centre.u, from.v - centre.v);
      return Array.from({ length: 25 }, (_, i) => [centre.u + radius * Math.cos(a0 + (sweep * i) / 24), centre.v + radius * Math.sin(a0 + (sweep * i) / 24)]);
    };
    return [[[corners.aLeft.u, corners.aLeft.v], [corners.bLeft.u, corners.bLeft.v]], [[corners.bRight.u, corners.bRight.v], [corners.aRight.u, corners.aRight.v]], ring(second, corners.bRight, corners.bLeft), ring(first, corners.aLeft, corners.aRight)];
  }
  if (ctx.tool === "circle3" || ctx.tool === "arc3") {
    if (!second) return [[[first.u, first.v], [c.u, c.v]]];
    const probe = Sh.circumcircle(first, second, c);
    if (!probe) return ctx.tool === "arc3" ? [[[first.u, first.v], [second.u, second.v]]] : [[[first.u, first.v], [second.u, second.v], [c.u, c.v]]];
    if (ctx.tool === "arc3") {
      // Start, end, then the point it passes through: the pointer is the through point, the second click was the end.
      const arc = Sh.arcThrough(first, c, second)!;
      const [from, to] = arc.from === "start" ? [first, second] : [second, first];
      const a0 = Math.atan2(from.v - probe.v, from.u - probe.u);
      const sweep = (Math.atan2(to.v - probe.v, to.u - probe.u) - a0 + 4 * Math.PI) % (2 * Math.PI);
      return [Array.from({ length: 49 }, (_, i) => [probe.u + probe.radius * Math.cos(a0 + (sweep * i) / 48), probe.v + probe.radius * Math.sin(a0 + (sweep * i) / 48)] as [number, number])];
    }
    if (ctx.tool === "circle3") return [Array.from({ length: 49 }, (_, i) => [probe.u + probe.radius * Math.cos((2 * Math.PI * i) / 48), probe.v + probe.radius * Math.sin((2 * Math.PI * i) / 48)] as [number, number])];
  }
  const r = Math.hypot(c.u - first.u, c.v - first.v);
  if (ctx.tool === "circle") return [Array.from({ length: 49 }, (_, i) => [first.u + r * Math.cos((2 * Math.PI * i) / 48), first.v + r * Math.sin((2 * Math.PI * i) / 48)] as [number, number])];
  if (ctx.tool === "arc") {
    const second = ctx.chain[1];
    if (!second) return [[[first.u, first.v], [c.u, c.v]]];
    const radius = Math.hypot(second.u - first.u, second.v - first.v);
    const a0 = Math.atan2(second.v - first.v, second.u - first.u);
    let sweep = Sh.arcSweepToward(first, second, c); // follows the pointer: clockwise or counterclockwise from the start
    if ((ctx.typed || ctx.arcOptions?.sweep != null) && sweep <= 0) sweep += 2 * Math.PI; // a typed sweep is always counterclockwise
    return [Array.from({ length: 49 }, (_, i) => [first.u + radius * Math.cos(a0 + (sweep * i) / 48), first.v + radius * Math.sin(a0 + (sweep * i) / 48)] as [number, number])];
  }
  return [];
}
