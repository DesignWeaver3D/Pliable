/** Finding and repairing loose ends in a sketch: points that nearly touch, and ends that join nothing. No DOM. */
import { entityPoints } from "./sketchmodel.ts";
import type { SketchData, SketchEntity } from "./sketchmodel.ts";

/** How close two points must be, relative to the sketch's size, to count as meant to touch. */
export const GAP_FRACTION = 0.005;

export interface Gap {
  keep: number;
  drop: number;
  distance: number;
}

const extent = (s: SketchData) => {
  const us = s.points.map((p) => p.u);
  const vs = s.points.map((p) => p.v);
  return s.points.length ? Math.max(Math.max(...us) - Math.min(...us), Math.max(...vs) - Math.min(...vs), 1) : 1;
};

/** Distinct points of shapes that lie closer than the tolerance but are not the same point. */
export function findGaps(s: SketchData): Gap[] {
  const tolerance = GAP_FRACTION * extent(s);
  const used = new Set(s.entities.filter((e) => !e.reference).flatMap(entityPoints));
  const ids = s.points.filter((p) => used.has(p.id) || p.fixed);
  const gaps: Gap[] = [];
  const dropped = new Set<number>();
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const [a, b] = [ids[i], ids[j]];
      if (dropped.has(a.id) || dropped.has(b.id) || (a.fixed && b.fixed)) continue;
      const distance = Math.hypot(a.u - b.u, a.v - b.v);
      if (distance > tolerance || distance === 0) continue;
      const [keep, drop] = b.fixed ? [b, a] : [a, b]; // a fixed reference point is never the one replaced
      gaps.push({ keep: keep.id, drop: drop.id, distance });
      dropped.add(drop.id);
    }
  }
  return gaps;
}

/** Line and arc ends that nothing else touches: where an outline is open. */
export function openEnds(s: SketchData): number[] {
  const count = new Map<number, number>();
  for (const e of s.entities) {
    if (e.type !== "line" && e.type !== "arc" && !(e.type === "ellipse" && e.start !== undefined)) continue;
    const ends = e.type === "line" ? [e.a, e.b] : [e.start!, e.end!];
    for (const id of ends) count.set(id, (count.get(id) ?? 0) + 1);
  }
  const joined = new Set(s.constraints.filter((c) => c.type === "coincident").flatMap((c) => c.points ?? []));
  const onCurve = new Set(s.constraints.filter((c) => c.type === "point_on" || c.type === "midpoint").map((c) => c.point));
  return [...count].filter(([id, n]) => n === 1 && !joined.has(id) && !onCurve.has(id) && !s.points.find((p) => p.id === id)?.fixed).map(([id]) => id);
}

/** The sketch with each gap's dropped point replaced by the kept one everywhere; shapes left with no length go. */
export function joinGaps(s: SketchData, gaps: Gap[]): SketchData {
  const into = new Map(gaps.map((g) => [g.drop, g.keep]));
  const at = (id: number) => into.get(id) ?? id;
  const entities = s.entities
    .map((e) => {
      const copy = { ...e } as Record<string, unknown>;
      for (const key of ["a", "b", "center", "start", "end", "major"]) if (typeof copy[key] === "number") copy[key] = at(copy[key] as number);
      if (Array.isArray(copy.points)) copy.points = (copy.points as number[]).map(at);
      return copy as unknown as SketchEntity;
    })
    .filter((e) => !(e.type === "line" && e.a === e.b));
  const alive = new Set(entities.map((e) => e.id));
  const constraints = s.constraints
    .map((c) => ({ ...c, ...(c.points ? { points: c.points.map(at) } : {}), ...(c.point !== undefined ? { point: at(c.point) } : {}) }))
    .filter((c) => !(c.type === "coincident" && c.points![0] === c.points![1]))
    .filter((c) => (c.entity === undefined || alive.has(c.entity)) && (c.entities ?? []).every((id) => alive.has(id)));
  return { ...s, entities, constraints, points: s.points.filter((p) => !into.has(p.id)) };
}

/** A one-line description of what is loose in the sketch. */
export function describeProblems(s: SketchData): string {
  const gaps = findGaps(s).length;
  const open = openEnds(s).length;
  if (!gaps && !open) return "Nothing loose: every end meets another shape, and no points nearly touch";
  return [gaps ? `${gaps} pair${gaps === 1 ? "" : "s"} of points nearly touch (Join near points merges them)` : "", open ? `${open} open end${open === 1 ? "" : "s"} (Check sketch selects them)` : ""].filter(Boolean).join("; ");
}
