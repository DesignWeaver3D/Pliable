/** Snap points of a kept sketch for the 3D point picks (move, array, rotate base and destination points): its ends, centers and midpoints, and its curves. */
import * as M from "./sketchmodel.ts";

export interface SketchSnapPoint {
  point: [number, number, number];
  label: string;
}

/** The points a pick may snap to: every end or center of a drawn curve (construction and projected reference curves left out) and the middle of each line. */
export function sketchSnapPoints(data: M.SketchData): SketchSnapPoint[] {
  const out: SketchSnapPoint[] = [];
  const seen = new Set<number>();
  const add = (id: number, label: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const p = M.pointOf(data, id);
    out.push({ point: M.toWorld(data.plane, p.u, p.v), label });
  };
  for (const e of data.entities) {
    if (e.construction || e.reference) continue;
    if (e.type === "line") {
      add(e.a, "Sketch point");
      add(e.b, "Sketch point");
      const a = M.pointOf(data, e.a);
      const b = M.pointOf(data, e.b);
      out.push({ point: M.toWorld(data.plane, (a.u + b.u) / 2, (a.v + b.v) / 2), label: "Sketch midpoint" });
    } else if (e.type === "circle") add(e.center, "Sketch center");
    else if (e.type === "arc") {
      add(e.center, "Sketch center");
      add(e.start, "Sketch point");
      add(e.end, "Sketch point");
    } else if (e.type === "ellipse") {
      add(e.center, "Sketch center");
      if (e.start !== undefined && e.end !== undefined) {
        add(e.start, "Sketch point");
        add(e.end, "Sketch point");
      }
    } else for (const id of e.points) add(id, "Sketch point");
  }
  return out;
}

/** The point on the segments (pairs of world points in a flat array) nearest the pointer, with its distance in pixels. */
export function nearestOnSegments(positions: ArrayLike<number>, toScreen: (p: [number, number, number]) => { x: number; y: number }, here: { x: number; y: number }): { point: [number, number, number]; px: number } | null {
  let best: { point: [number, number, number]; px: number } | null = null;
  for (let i = 0; i + 5 < positions.length; i += 6) {
    const a: [number, number, number] = [positions[i], positions[i + 1], positions[i + 2]];
    const b: [number, number, number] = [positions[i + 3], positions[i + 4], positions[i + 5]];
    const pa = toScreen(a);
    const pb = toScreen(b);
    const [dx, dy] = [pb.x - pa.x, pb.y - pa.y];
    const len = dx * dx + dy * dy;
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((here.x - pa.x) * dx + (here.y - pa.y) * dy) / len));
    const px = Math.hypot(here.x - (pa.x + t * dx), here.y - (pa.y + t * dy));
    if (!best || px < best.px) best = { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], px };
  }
  return best;
}
