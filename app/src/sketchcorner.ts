/** The Fillet and Chamfer sketch tools: which corner a click names. A click on a point names that point; a click on a line names the end of
 *  that line nearest the click where exactly two lines meet. The rounding itself is `roundCorner` in sketchmodel.ts. */
import { entityPoints, pointOf } from "./sketchmodel.ts";
import type { SketchData, SketchSel } from "./sketchmodel.ts";

export function cornerAt(s: SketchData, hit: SketchSel | null, u: number, v: number): number | null {
  if (!hit) return null;
  if (hit.kind === "point") return hit.id;
  const line = s.entities.find((e) => e.id === hit.id);
  if (!line || line.type !== "line") return null;
  const isCorner = (pid: number) => s.entities.filter((e) => entityPoints(e).includes(pid)).length === 2;
  const ends = [line.a, line.b].filter(isCorner).sort((p, q) => Math.hypot(pointOf(s, p).u - u, pointOf(s, p).v - v) - Math.hypot(pointOf(s, q).u - u, pointOf(s, q).v - v));
  return ends[0] ?? null;
}
