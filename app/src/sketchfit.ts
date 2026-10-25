/** The world points the zoom-to-fit buttons use while a sketch is open: the sketch's own geometry, all of it or only the selection. No DOM. */
import * as M from "./sketchmodel.ts";

/** Points along every curve of the sketch (and its stand-alone points), in world coordinates; null when there is nothing to fit. */
export function fitPointsAll(s: M.SketchData): number[][] | null {
  const uv: [number, number][] = [];
  for (const e of s.entities) uv.push(...M.polyline(s, e, 24));
  const used = new Set(s.entities.flatMap((e) => M.entityPoints(e)));
  for (const p of s.points) if (!used.has(p.id) && !p.fixed) uv.push([p.u, p.v]);
  const world = uv.map(([u, v]) => M.toWorld(s.plane, u, v));
  if (!world.length) return null;
  return [...world, ...dimensionPoints(s)];
}

/** Where the sketch's dimensions reach (their measured points, their dragged-out lines and leaders), so a fit of everything keeps them in view. */
export function dimensionPoints(s: M.SketchData): number[][] {
  const out: number[][] = [];
  for (const d of M.dimensionsOf(s)) {
    out.push(...d.points);
    if (d.offset !== undefined && d.offsetDirection) out.push(...d.points.map((p) => p.map((c, k) => c + d.offsetDirection![k] * d.offset!)));
    if (d.labelAt) out.push(d.labelAt);
  }
  return out;
}

/** Screen pixels of room to leave around a fit of everything for the dimension lines and numbers beside the geometry (none without dimensions). */
export function dimensionPad(s: M.SketchData): number {
  return s.constraints.some((c) => c.value !== undefined) ? 70 : 0;
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

/** The box [minx, miny, minz, maxx, maxy, maxz] a sketch fit zooms to: exactly the points' extent. Only a box of no size at all (a lone point) is widened, so there is something to frame; a small sketch is never padded out. */
export function fitBoxOf(points: number[][]): number[] {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of points) for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k], p[k]), (hi[k] = Math.max(hi[k], p[k])));
  if (Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) < 1e-9) for (let k = 0; k < 3; k++) (lo[k] -= 5, (hi[k] += 5));
  return [...lo, ...hi];
}
