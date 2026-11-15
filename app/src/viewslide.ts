/** Sliding bodies on the client while a move handle is dragged: the bodies' own meshes are shifted without the core. */
import type { Viewport } from "./viewport.ts";

/** The part of the Viewport this file uses. */
export type SlideContext = Pick<Viewport, "bodyMeshes" | "data" | "moving">;

/**
 * Show the given bodies moved by `offset` from where the current mesh has them, at once and without the core: each body
 * has its own mesh, so only their positions change. The next `setMesh` puts every body back where the reply has it, so
 * the core's reply simply takes over.
 */
export function slideBodies(view: SlideContext, bodies: Set<number>, offset: [number, number, number]) {
  const data = view.data;
  if (!data) return;
  const same = view.moving && view.moving.data === data && view.moving.bodies.size === bodies.size && [...bodies].every((b) => view.moving!.bodies.has(b));
  if (!same) {
    unsplit(view);
    const has = (r: { body?: number | null; count: number }) => r.body != null && bodies.has(r.body) && r.count > 0;
    if (!data.faces.some(has) && !data.edges.some(has)) return;
    view.moving = { bodies: new Set(bodies), data };
  }
  view.bodyMeshes.slide(view.moving!.bodies, offset);
}

/** Put the slid bodies back in place (before another set of bodies is slid). */
export function unsplit(view: SlideContext) {
  if (!view.moving) return;
  view.bodyMeshes.slide(null);
  view.moving = null;
}
