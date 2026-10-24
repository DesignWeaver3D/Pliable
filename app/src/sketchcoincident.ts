/** Coincidence in a sketch. Lines drawn end to end share one point, which holds them together without a constraint
 *  object; this module lists those shared points like constraints, lets a shared point be split so the pieces move
 *  apart, and picks which constraints belong to the selection. No DOM. */
import type { SketchConstraint, SketchData, SketchSel } from "./sketchmodel.ts";
import { entityPoints } from "./sketchmodel.ts";

/** Points used by two or more of the sketch's own curves (not the fixed or reference geometry), with the curves that meet there. */
export function sharedPoints(s: SketchData): { point: number; entities: number[] }[] {
  const users = new Map<number, number[]>();
  for (const e of s.entities) {
    if (e.reference) continue;
    for (const id of new Set(entityPoints(e))) users.set(id, [...(users.get(id) ?? []), e.id]);
  }
  const fixed = new Set(s.points.filter((p) => p.fixed).map((p) => p.id));
  return [...users].filter(([id, list]) => list.length > 1 && !fixed.has(id)).map(([point, entities]) => ({ point, entities }));
}

/** The shared points as constraint-like rows for the list: a negative id (minus the point's id) marks them as not real constraints. */
export function sharedAsConstraints(s: SketchData): SketchConstraint[] {
  return sharedPoints(s).map(({ point, entities }) => ({ id: -point, type: "coincident", point, entities, auto: true }));
}

/** Give each curve but the first its own copy of a shared point, at the same place, so they are no longer held together. */
export function splitPoint(s: SketchData, pointId: number): SketchData {
  const shared = sharedPoints(s).find((x) => x.point === pointId);
  const original = s.points.find((p) => p.id === pointId);
  if (!shared || !original) return s;
  let next = Math.max(0, ...s.points.map((p) => p.id), ...s.entities.map((e) => e.id), ...s.constraints.map((c) => c.id)) + 1;
  const points = [...s.points];
  const entities = s.entities.map((e) => {
    if (!shared.entities.slice(1).includes(e.id)) return e;
    const copy = next++;
    points.push({ ...original, id: copy });
    const swap = (id: number) => (id === pointId ? copy : id);
    const m = e as Record<string, unknown>;
    const changed: Record<string, unknown> = { ...m };
    for (const key of ["a", "b", "center", "start", "end", "major"]) if (typeof m[key] === "number") changed[key] = swap(m[key] as number);
    if (Array.isArray(m.points)) changed.points = (m.points as number[]).map(swap);
    return changed as unknown as typeof e;
  });
  return { ...s, points, entities };
}

/** Remove what holds the given points to other geometry: coincident constraints that name them, and shared points are split. Null when nothing held them. */
export function releasePoints(s: SketchData, ids: number[]): SketchData | null {
  const named = (c: SketchConstraint) => c.type === "coincident" && (c.points ?? []).some((p) => ids.includes(p));
  let out: SketchData = { ...s, constraints: s.constraints.filter((c) => !named(c)) };
  let changed = out.constraints.length !== s.constraints.length;
  for (const id of ids) {
    const split = splitPoint(out, id);
    if (split !== out) changed = true;
    out = split;
  }
  return changed ? out : null;
}

/** The constraints that belong to the selection: those naming a selected curve or point, or a point of a selected curve. All of them when nothing is selected. */
export function constraintsFor(s: SketchData, all: SketchConstraint[], selection: SketchSel[]): SketchConstraint[] {
  if (!selection.length) return all;
  const entities = new Set(selection.filter((x) => x.kind === "entity").map((x) => x.id));
  const points = new Set(selection.filter((x) => x.kind === "point").map((x) => x.id));
  for (const e of s.entities) if (entities.has(e.id)) for (const p of entityPoints(e)) points.add(p);
  return all.filter((c) => {
    const ents = [...(c.entities ?? []), ...(c.entity !== undefined ? [c.entity] : [])];
    const pts = [...(c.points ?? []), ...(c.point !== undefined ? [c.point] : [])];
    return ents.some((e) => entities.has(e)) || pts.some((p) => points.has(p));
  });
}
