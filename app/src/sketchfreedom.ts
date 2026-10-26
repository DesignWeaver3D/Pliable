/** What still has freedom in a sketch: the points that can move and the curves that run through them. The degrees of freedom message
 *  in the sketch card turns this highlight on and off (in bright yellow). */
import type { SketchData } from "./sketchmodel.ts";
import { entityPoints } from "./sketchmodel.ts";

export const FREE_COLOR = 0xffe600;

export interface FreeParts {
  points: Set<number>;
  entities: Set<number>;
  /** Points the core did not get to in its time limit: neither lit nor known to be placed. */
  unknown: number;
}

/** `freedom` is the core's answer per point (0 = placed, 1 or 2 = free directions); points it did not reach are left out. `freeSizes` are the circles whose radius is free. */
export function freeParts(s: SketchData, freedom: Map<number, number>, freeSizes: Set<number> = new Set()): FreeParts {
  const points = new Set<number>();
  for (const p of s.points) if ((freedom.get(p.id) ?? 0) > 0) points.add(p.id);
  const entities = new Set<number>();
  for (const e of s.entities) if (freeSizes.has(e.id) || entityPoints(e).some((id) => points.has(id))) entities.add(e.id);
  const unknown = s.points.filter((p) => !freedom.has(p.id)).length;
  return { points, entities, unknown };
}

/** The text after the click: what is lit, or why nothing is (the freedom is in a size, or the sketch has not been worked out yet). */
export function freeMessage(parts: FreeParts, dof: number | null): string {
  if (!dof) return "Nothing has freedom left";
  if (parts.points.size === 0 && parts.entities.size > 0) return `${parts.entities.size} curve${parts.entities.size === 1 ? "" : "s"} still ${parts.entities.size === 1 ? "has" : "have"} a free size (lit yellow)`;
  if (parts.points.size === 0 && parts.unknown > 0) return `${dof} degree${dof === 1 ? "" : "s"} of freedom left; ${parts.unknown} point${parts.unknown === 1 ? "" : "s"} could not be checked in time`;
  if (parts.points.size === 0) return `${dof} degree${dof === 1 ? "" : "s"} of freedom left, but no point can move: the freedom is in a size, such as a radius or an ellipse axis`;
  return `${parts.points.size} point${parts.points.size === 1 ? "" : "s"} and ${parts.entities.size} curve${parts.entities.size === 1 ? "" : "s"} still have freedom (lit yellow)`;
}
