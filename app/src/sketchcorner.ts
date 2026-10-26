/** The Fillet and Chamfer sketch tools: which corner a click names, and the rounding. A click on a point names that point; a click on a line or arc names the end of
 *  that curve nearest the click where exactly two lines or arcs meet. Two lines are rounded by `roundCorner` in sketchmodel.ts; anything with an arc or circle, and
 *  two curves picked one after the other, by `roundCurves` in sketchcornercurves.ts. */
import { pointOf, roundCorner } from "./sketchmodel.ts";
import { curvesAtCorner, roundCurves } from "./sketchcornercurves.ts";
import type { SketchData, SketchSel } from "./sketchmodel.ts";

export function cornerAt(s: SketchData, hit: SketchSel | null, u: number, v: number): number | null {
  if (!hit) return null;
  if (hit.kind === "point") return hit.id;
  const curve = s.entities.find((e) => e.id === hit.id);
  if (!curve || (curve.type !== "line" && curve.type !== "arc")) return null;
  const own = curve.type === "line" ? [curve.a, curve.b] : [curve.start, curve.end];
  const away = (pid: number) => Math.hypot(pointOf(s, pid).u - u, pointOf(s, pid).v - v);
  const ends = own.filter((pid) => curvesAtCorner(s, pid)).sort((p, q) => away(p) - away(q));
  return ends[0] ?? null;
}

/** Whether a click on this item can start a pair of curves (a line, arc or circle). */
export function isCurvePick(s: SketchData, hit: SketchSel | null): hit is SketchSel {
  const e = hit && hit.kind === "entity" ? s.entities.find((x) => x.id === hit.id) : undefined;
  return !!e && (e.type === "line" || e.type === "arc" || e.type === "circle");
}

/** Round or bevel the corner at point `corner`; (u, v) is the pointer, which picks the side of a fillet. */
export function roundAt(s: SketchData, corner: number, kind: "fillet" | "chamfer", size: number, u: number, v: number): SketchData | string {
  const pair = curvesAtCorner(s, corner);
  if (!pair) return "Select a corner where exactly two lines or arcs meet";
  if (pair.every((id) => s.entities.find((e) => e.id === id)?.type === "line")) return roundCorner(s, corner, kind, size);
  return roundCurves(s, pair[0], pair[1], kind, size, [u, v], corner);
}

/** Round or bevel between two picked curves, which need not touch; (u, v) is the second click. */
export function roundPair(s: SketchData, first: number, second: number, kind: "fillet" | "chamfer", size: number, u: number, v: number): SketchData | string {
  return roundCurves(s, first, second, kind, size, [u, v], null);
}
