/** The world points the zoom-to-fit buttons use while a sketch is open: the sketch's own geometry, all of it or only the selection. No DOM. */
import * as M from "./sketchmodel.ts";

/** Points along every curve of the sketch (and its stand-alone points), in world coordinates; null when there is nothing to fit. */
export function fitPointsAll(s: M.SketchData): number[][] | null {
  const uv: [number, number][] = [];
  for (const e of s.entities) uv.push(...M.polyline(s, e, 24));
  const used = new Set(s.entities.flatMap((e) => M.entityPoints(e)));
  for (const p of s.points) if (!used.has(p.id) && !p.fixed) uv.push([p.u, p.v]);
  return uv.length ? uv.map(([u, v]) => M.toWorld(s.plane, u, v)) : null;
}

/** The same for the selected points and curves; null when none are selected. */
export function fitPointsSelected(s: M.SketchData, selection: M.SketchSel[]): number[][] | null {
  const uv: [number, number][] = [];
  for (const sel of selection) {
    if (sel.kind === "point") {
      const p = s.points.find((q) => q.id === sel.id);
      if (p) uv.push([p.u, p.v]);
    } else {
      const e = s.entities.find((q) => q.id === sel.id);
      if (e) uv.push(...M.polyline(s, e, 24));
    }
  }
  return uv.length ? uv.map(([u, v]) => M.toWorld(s.plane, u, v)) : null;
}
