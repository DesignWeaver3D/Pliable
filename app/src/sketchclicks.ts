/** What a click does for the tools that act on existing curves rather than draw new ones: Fillet and Chamfer, the two tangent circle tools, and Trim, Extend and Split.
 *  Moved out of sketch.ts; `SketchMode` passes itself as the context and redraws afterward. The geometry is in sketchcorner.ts, sketchtangentcircle.ts, sketchtrim.ts and sketchedit.ts. */
import * as M from "./sketchmodel.ts";
import * as E from "./sketchedit.ts";
import { cornerAt, isCurvePick, roundAt, roundPair } from "./sketchcorner.ts";
import { pickTangent } from "./sketchtangentcircle.ts";
import { ellipseThroughPoint, splitEllipse } from "./sketchsplitellipse.ts";
import { trimClick } from "./sketchtrim.ts";
import type { Tool } from "./sketchtypes.ts";

type Pt = [number, number];

/** The part of the sketch mode these tools use. */
export interface ClickContext {
  /** The current sketch, read live: undo replaces it. */
  s: M.SketchData;
  tool: Tool;
  selection: M.SketchSel[];
  rectOptions: { size: number };
  arcOptions: { radius: number };
  options: { auto: string };
  /** The first curve picked for a Fillet or Chamfer between two curves that need not touch. */
  cornerFirst: number | null;
  /** Curves picked so far for the Tangent circle and Arc tangent to curves tools. */
  tanPicks: number[];
  /** Lines Trim has cut and marked, waiting for the second click that deletes them. */
  trimCandidates: Set<number>;
  pushUndo(): void;
  resolve(): unknown;
  status(text: string, error?: boolean | "warn"): void;
}

/** A click of Fillet or Chamfer: on a corner, or the first and then the second of two curves. */
export function cornerClick(ctx: ClickContext, hit: M.SketchSel | null, uv: Pt | null) {
  const first = ctx.cornerFirst;
  const kind = ctx.tool as "fillet" | "chamfer";
  let made: M.SketchData | string | null = null;
  if (!uv) made = null;
  else if (first !== null) {
    ctx.cornerFirst = null;
    ctx.selection = [];
    if (!isCurvePick(ctx.s, hit) || hit.id === first) ctx.status("Pick a second line, arc or circle", true);
    else made = roundPair(ctx.s, first, hit.id, kind, ctx.rectOptions.size, uv[0], uv[1]);
  } else {
    const corner = cornerAt(ctx.s, hit, uv[0], uv[1]);
    if (corner !== null) made = roundAt(ctx.s, corner, kind, ctx.rectOptions.size, uv[0], uv[1]);
    else if (isCurvePick(ctx.s, hit)) {
      ctx.cornerFirst = hit.id;
      ctx.selection = [hit];
      ctx.status(`Now click the second curve, on the side where the ${ctx.tool === "fillet" ? "fillet" : "bevel"} goes`);
    } else ctx.status("Click a corner where two lines or arcs meet, or pick two curves", true);
  }
  if (made !== null) {
    if (typeof made === "string") ctx.status(made, true);
    else {
      ctx.pushUndo();
      ctx.s = made;
      ctx.resolve();
      ctx.status(ctx.tool === "fillet" ? "Rounded the corner" : "Bevelled the corner");
    }
    ctx.selection = [];
  }
}

/** A click of Tangent circle or Tangent arc: another curve to touch, or the click that makes the shape. */
export function tangentClick(ctx: ClickContext, hit: M.SketchSel | null, uv: Pt | null) {
  if (!uv) return;
  const step = pickTangent(ctx.s, ctx.tanPicks, hit, uv, ctx.tool as "tancircle" | "tanarc", ctx.arcOptions.radius);
  ctx.tanPicks = step.picks;
  ctx.selection = step.picks.map((id) => ({ kind: "entity" as const, id }));
  if (step.message) ctx.status(step.message, step.made === undefined && step.picks.length === 0);
  if (typeof step.made === "string") ctx.status(step.made, true);
  else if (step.made) {
    ctx.pushUndo();
    ctx.s = step.made;
    ctx.resolve();
    ctx.status(ctx.tool === "tancircle" ? "Made the tangent circle" : "Made the tangent arc");
  }
}

/** A click of Trim, Extend or Split on a line, an ellipse or a point on one. */
export function cutClick(ctx: ClickContext, hit: M.SketchSel | null, uv: Pt | null) {
  const apply = (sketch: M.SketchData) => {
    ctx.pushUndo();
    ctx.s = sketch;
    ctx.resolve();
  };
  if (ctx.tool === "split" && hit?.kind === "point") {
    // a click on a point that lies on a line cuts the line exactly there (the point joins both pieces)
    const through = E.lineThroughPoint(ctx.s, hit.id);
    const at = ctx.s.points.find((x) => x.id === hit.id);
    const round = through === null ? ellipseThroughPoint(ctx.s, hit.id) : null;
    const cut = through !== null && at ? E.splitLine(ctx.s, through, at.u, at.v, 0, hit.id) : round !== null && at ? splitEllipse(ctx.s, round, at.u, at.v, 0, hit.id) : null;
    if (cut) apply(cut.sketch);
    return;
  }
  const line = hit?.kind === "entity" ? ctx.s.entities.find((x) => x.id === hit.id) : undefined;
  if (ctx.tool === "split" && line?.type === "ellipse" && uv && !line.reference) {
    const cut = splitEllipse(ctx.s, line.id, uv[0], uv[1]);
    if (cut) apply(cut.sketch);
    else ctx.status("Click along the ellipse, away from the ends of an arc, to cut it (an old ellipse without axis ends cannot be cut)", true);
  } else if (ctx.tool === "trim" && (line?.type === "circle" || line?.type === "arc" || line?.type === "ellipse") && uv && !line.reference) {
    const trimmed = trimClick(ctx.s, line.id, uv[0], uv[1], ctx.trimCandidates, ctx.options.auto !== "none");
    if (typeof trimmed === "string") ctx.status(trimmed, true);
    else if (trimmed) {
      ctx.pushUndo();
      ctx.s = trimmed.sketch;
      ctx.trimCandidates = trimmed.candidates;
      ctx.resolve();
    }
  } else if (line?.type === "line" && uv && !line.reference) {
    if (ctx.tool === "split") {
      const cut = E.splitLine(ctx.s, line.id, uv[0], uv[1]);
      if (cut) apply(cut.sketch);
      else ctx.status("Click along the line, away from its ends, to cut it", true);
    } else if (ctx.tool === "trim") {
      const trimmed = trimClick(ctx.s, line.id, uv[0], uv[1], ctx.trimCandidates, ctx.options.auto !== "none");
      if (trimmed && typeof trimmed !== "string") {
        ctx.pushUndo();
        ctx.s = trimmed.sketch;
        ctx.trimCandidates = trimmed.candidates;
        ctx.resolve();
      }
    } else apply(M.extendLine(ctx.s, line.id, uv[0], uv[1]));
  }
}
