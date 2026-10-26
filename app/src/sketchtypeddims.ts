/** The dimensions drawn while sizes are typed for a shape being drawn: real extension lines, dimension lines and leaders, with the typed value in them
 *  (the one being typed has a caret and is orange). The shape's rubber band follows the typed sizes too. No DOM. */
import type { Dimension } from "./dimensions";
import * as M from "./sketchmodel.ts";
import { typedLabels, typedTargets } from "./sketchtyped.ts";
import type { UV } from "./sketchshapes.ts";
import type { PreviewContext } from "./sketchpreview.ts";
import { showNumber } from "./precision.ts";

const n = (x: number) => showNumber(x);

/** The numbers typed so far (a number still being typed counts), in order; the ones not typed yet are missing. */
function typedNumbers(text: string): number[] {
  return text.trim().split(/\s+/).map(Number).filter((x) => Number.isFinite(x) && x > 0);
}

/** Where the typed sizes put the next point, or null when nothing usable is typed yet. */
export function typedPoint(ctx: PreviewContext): UV | null {
  const first = ctx.chain[0];
  const numbers = typedNumbers(ctx.typed);
  if (!first || !numbers.length) return null;
  const labels = typedLabels(ctx.tool, ctx.chain.length, !!ctx.sidesOf(ctx.tool));
  return typedTargets(ctx.tool, ctx.chain, ctx.cursor, numbers.slice(0, labels.length))[0] ?? null;
}

/** The dimensions for the sizes being typed: each number the shape takes is drawn where it applies, with its value (the typed text for the active one). */
export function typedDimensions(ctx: PreviewContext): Dimension[] {
  const c = ctx.cursor;
  const labels = typedLabels(ctx.tool, ctx.chain.length, !!ctx.sidesOf(ctx.tool));
  const numbers = typedNumbers(ctx.typed).slice(0, labels.length);
  if (!c || !ctx.chain.length || !labels.length || !numbers.length) return [];
  const plane = ctx.s.plane;
  const world = (p: UV) => M.toWorld(plane, p.u, p.v);
  const direction = (du: number, dv: number) => {
    const o = M.toWorld(plane, 0, 0);
    return M.toWorld(plane, du, dv).map((x, k) => x - o[k]);
  };
  const active = Math.min(labels.length - 1, Math.max(0, ctx.typed.trim().split(/\s+/).length - (ctx.typed.endsWith(" ") ? 0 : 1)));
  const tokens = ctx.typed.trim().split(/\s+/);
  /** The value text of field `i`: what is being typed (with the caret) for the active one, else the size the shape has. */
  const shown = (i: number, size: number, prefix = "", suffix = "") => `${prefix}${i === active && tokens[i] !== undefined ? `${tokens[i]}|` : n(size)}${suffix}`;
  const targets = typedTargets(ctx.tool, ctx.chain, c, numbers);
  const first = ctx.chain[0];
  const last = ctx.chain[ctx.chain.length - 1];
  const out: Dimension[] = [];
  const linear = (i: number, a: UV, b: UV, away: [number, number] | null, size = Math.hypot(b.u - a.u, b.v - a.v)) =>
    out.push({ kind: "linear", text: shown(i, size), points: [world(a), world(b)], ...(away ? { offsetDirection: direction(away[0], away[1]) } : {}), selected: i === active });
  const radius = (i: number, centre: UV, rim: UV, prefix = "R") =>
    out.push({ kind: "radius", text: shown(i, Math.hypot(rim.u - centre.u, rim.v - centre.v), prefix), points: [world(centre), world(rim)], selected: i === active });
  const target = targets[0];
  if (!target) return [];

  if (ctx.tool === "rectangle" || ctx.tool === "rectcentre") {
    const corner = ctx.tool === "rectcentre" ? { u: 2 * first.u - target.u, v: 2 * first.v - target.v } : first;
    const sideU = Math.sign(target.u - corner.u) || 1;
    const sideV = Math.sign(target.v - corner.v) || 1;
    linear(0, corner, { u: target.u, v: corner.v }, [0, -sideV]);
    linear(1, { u: target.u, v: corner.v }, target, [sideU, 0]);
  } else if (ctx.tool === "circle") {
    // The typed number is the diameter: the line runs across the circle and the leader leaves from its far end.
    out.push({ kind: "diameter", text: shown(0, 2 * Math.hypot(target.u - first.u, target.v - first.v), "Ø"), points: [world({ u: 2 * first.u - target.u, v: 2 * first.v - target.v }), world(target)], selected: 0 === active });
  } else if (ctx.sidesOf(ctx.tool)) {
    radius(0, first, target);
  } else if (ctx.tool === "line") {
    linear(0, last, target, null);
  } else if (ctx.tool === "slot") {
    // First stage: the length between the two centres, and the width across the second centre. Second stage: the width across the first centre.
    const [a, b] = ctx.chain.length === 2 ? [first, ctx.chain[1]] : [first, target];
    if (ctx.chain.length === 1) linear(0, a, b, null);
    const side = ctx.chain.length === 2 ? target : targets[1];
    if (side) {
      const mirrored = { u: 2 * a.u - side.u, v: 2 * a.v - side.v };
      const [du, dv] = [side.u - a.u, side.v - a.v];
      linear(ctx.chain.length === 2 ? 0 : 1, mirrored, side, [-dv, du], 2 * Math.hypot(du, dv));
    }
  } else if (ctx.tool === "ellipse") {
    const major = ctx.chain.length === 2 ? ctx.chain[1] : target;
    const [mu, mv] = [major.u - first.u, major.v - first.v];
    // The major width runs across the whole long axis and the minor width across the short one; each is drawn beside its axis.
    if (ctx.chain.length === 1) linear(0, { u: first.u - mu, v: first.v - mv }, { u: first.u + mu, v: first.v + mv }, [-mv, mu], 2 * Math.hypot(mu, mv));
    const minor = ctx.chain.length === 2 ? target : targets[1];
    if (minor) {
      const [nu, nv] = [minor.u - first.u, minor.v - first.v];
      linear(ctx.chain.length === 2 ? 0 : 1, { u: first.u - nu, v: first.v - nv }, { u: first.u + nu, v: first.v + nv }, [mu, mv], 2 * Math.hypot(nu, nv));
    }
  } else if (ctx.tool === "arc") {
    const start = ctx.chain.length === 2 ? ctx.chain[1] : target;
    if (ctx.chain.length === 1) radius(0, first, start);
    const end = ctx.chain.length === 2 ? target : targets[1];
    if (end) {
      const r = Math.hypot(start.u - first.u, start.v - first.v);
      const a0 = Math.atan2(start.v - first.v, start.u - first.u);
      let sweep = Math.atan2(end.v - first.v, end.u - first.u) - a0;
      sweep = ((sweep + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; // the short way round, as the typed degrees were turned
      const typedDegrees = numbers[ctx.chain.length === 2 ? 0 : 1];
      if (typedDegrees !== undefined && typedDegrees > 180) sweep = (Math.sign(sweep || 1) * typedDegrees * Math.PI) / 180;
      const samples = Array.from({ length: 25 }, (_, k) => world({ u: first.u + r * Math.cos(a0 + (sweep * k) / 24), v: first.v + r * Math.sin(a0 + (sweep * k) / 24) }));
      const index = ctx.chain.length === 2 ? 0 : 1;
      out.push({ kind: "angle", text: shown(index, (Math.abs(sweep) * 180) / Math.PI, "", "°"), points: [world(first), ...samples], extend: [], selected: index === active });
    }
  }
  return out;
}
