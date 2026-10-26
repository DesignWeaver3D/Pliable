/** What still has freedom in a sketch: the points that can move and the curves that run through them. The degrees of freedom message
 *  in the sketch card turns this highlight on and off (in bright yellow). */
import type { SketchData } from "./sketchmodel.ts";
import { entityPoints } from "./sketchmodel.ts";

export const FREE_COLOR = 0xffe600;

export interface FreeParts {
  points: Set<number>;
  entities: Set<number>;
}

/** `freedom` is the core's answer per point (0 = placed, 1 or 2 = free directions); points it did not reach are left out. */
export function freeParts(s: SketchData, freedom: Map<number, number>): FreeParts {
  const points = new Set<number>();
  for (const p of s.points) if ((freedom.get(p.id) ?? 0) > 0) points.add(p.id);
  const entities = new Set<number>();
  for (const e of s.entities) if (entityPoints(e).some((id) => points.has(id))) entities.add(e.id);
  return { points, entities };
}

/** The text after the click: what is lit, or why nothing is (the freedom is in a size, or the sketch has not been worked out yet). */
export function freeMessage(parts: FreeParts, dof: number | null): string {
  if (!dof) return "Nothing has freedom left";
  if (parts.points.size === 0) return `${dof} degree${dof === 1 ? "" : "s"} of freedom left, but no point can move: the freedom is in a size, such as a radius or an ellipse axis`;
  return `${parts.points.size} point${parts.points.size === 1 ? "" : "s"} and ${parts.entities.size} curve${parts.entities.size === 1 ? "" : "s"} still have freedom (lit yellow)`;
}
