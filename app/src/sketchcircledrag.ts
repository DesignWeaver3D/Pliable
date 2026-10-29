import type { SketchData } from "./sketchmodel";

/** A circle no constraint mentions (its center may be joined or fixed): dragging the circle itself resizes it, the center staying put. */
export function isFreeCircle(s: Pick<SketchData, "entities" | "constraints">, id: number): boolean {
  const e = s.entities.find((x) => x.id === id);
  if (!e || e.type !== "circle" || e.reference) return false;
  return !s.constraints.some((c) => c.entities?.includes(id) || (c as { entity?: number }).entity === id);
}

/** The radius a free circle takes while its rim is dragged to (u, v): the distance from its center. Never zero. */
export function draggedRadius(centre: { u: number; v: number }, u: number, v: number): number {
  return Math.max(Math.hypot(u - centre.u, v - centre.v), 1e-6);
}
