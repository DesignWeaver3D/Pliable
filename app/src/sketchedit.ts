/** Editing a selection of sketch geometry as a whole: move, rotate, scale, mirror, and repeat in a line or around a point. No DOM. */
import { entityPoints, nextId, pointOf } from "./sketchmodel.ts";
import type { SketchData, SketchEntity, SketchSel } from "./sketchmodel.ts";

export type Map2 = (u: number, v: number) => [number, number];

export interface EditResult {
  sketch: SketchData;
  /** What was made or moved, to select afterwards. */
  selection: SketchSel[];
}

/** The geometry a selection stands for: the chosen shapes and the points they are built from, plus any chosen points. */
export function selected(s: SketchData, sel: SketchSel[]): { entities: SketchEntity[]; points: number[] } {
  const entities = sel.filter((x) => x.kind === "entity").map((x) => s.entities.find((e) => e.id === x.id)).filter((e): e is SketchEntity => !!e && !e.reference);
  const points = new Set<number>([...entities.flatMap(entityPoints), ...sel.filter((x) => x.kind === "point").map((x) => x.id)]);
  return { entities, points: [...points] };
}

/** The middle of the selected points: the default centre for rotating and scaling. */
export function centroid(s: SketchData, sel: SketchSel[]): [number, number] {
  const ids = selected(s, sel).points;
  if (!ids.length) return [0, 0];
  const pts = ids.map((id) => pointOf(s, id));
  return [pts.reduce((a, p) => a + p.u, 0) / pts.length, pts.reduce((a, p) => a + p.v, 0) / pts.length];
}

export const translation = (du: number, dv: number): Map2 => (u, v) => [u + du, v + dv];

export function rotation(degrees: number, cu: number, cv: number): Map2 {
  const [c, n] = [Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)];
  return (u, v) => [cu + (u - cu) * c - (v - cv) * n, cv + (u - cu) * n + (v - cv) * c];
}

export const scaling = (factor: number, cu: number, cv: number): Map2 => (u, v) => [cu + (u - cu) * factor, cv + (v - cv) * factor];

/** Reflection in the line through (u0, v0) with direction (du, dv). */
export function reflection(u0: number, v0: number, du: number, dv: number): Map2 {
  const length = Math.hypot(du, dv) || 1;
  const [x, y] = [du / length, dv / length];
  return (u, v) => {
    const [a, b] = [u - u0, v - v0];
    const along = a * x + b * y;
    return [u0 + 2 * along * x - a, v0 + 2 * along * y - b];
  };
}

/**
 * Apply `map` to the selected geometry. Without `copy` the points move in place (fixed reference points stay,
 * and a circle's or ellipse's size follows `scale`); with `copy` a map-transformed duplicate is added and
 * selected. `mirror` flips arcs so they still run counterclockwise. `axis` (a line entity) adds symmetric
 * constraints between each point and its copy, so the pair stays mirrored.
 */
export function transform(s: SketchData, sel: SketchSel[], map: Map2, o: { copy: boolean; scale?: number; mirror?: boolean; axis?: number }): EditResult {
  const { entities, points } = selected(s, sel);
  const scale = o.scale ?? 1;
  const sketch: SketchData = { ...s, points: s.points.map((p) => ({ ...p })), entities: s.entities.map((e) => ({ ...e }) as SketchEntity), constraints: [...s.constraints] };
  if (!o.copy) {
    for (const p of sketch.points) {
      if (!points.includes(p.id) || p.fixed) continue;
      [p.u, p.v] = map(p.u, p.v);
    }
    for (const e of sketch.entities) {
      if (!entities.some((x) => x.id === e.id)) continue;
      if (e.type === "circle") e.radius *= scale;
      if (e.type === "ellipse") e.minor *= scale;
    }
    return { sketch, selection: sel };
  }
  let id = nextId(s);
  const copyOf = new Map<number, number>();
  for (const pid of points) {
    const p = pointOf(s, pid);
    const [u, v] = map(p.u, p.v);
    copyOf.set(pid, id);
    sketch.points.push({ id: id++, u, v });
  }
  const created: SketchSel[] = [...copyOf.values()].map((pid) => ({ kind: "point" as const, id: pid }));
  const at = (pid: number) => copyOf.get(pid)!;
  for (const e of entities) {
    const base = { id: id++, ...(e.construction ? { construction: true } : {}) };
    let copy: SketchEntity;
    if (e.type === "line") copy = { ...base, type: "line", a: at(e.a), b: at(e.b) };
    else if (e.type === "circle") copy = { ...base, type: "circle", center: at(e.center), radius: e.radius * scale };
    else if (e.type === "arc") copy = { ...base, type: "arc", center: at(e.center), start: at(o.mirror ? e.end : e.start), end: at(o.mirror ? e.start : e.end) };
    else if (e.type === "ellipse") copy = { ...base, type: "ellipse", center: at(e.center), major: at(e.major), minor: e.minor * scale };
    else copy = { ...base, type: "spline", points: e.points.map(at), ...(e.closed ? { closed: true } : {}) };
    sketch.entities.push(copy);
    created.push({ kind: "entity", id: copy.id });
  }
  if (o.axis !== undefined) {
    const axis = s.entities.find((e) => e.id === o.axis);
    if (axis && axis.type === "line") {
      for (const pid of points) {
        const [a, b] = [pointOf(s, axis.a), pointOf(s, axis.b)];
        const p = pointOf(s, pid);
        const side = ((b.u - a.u) * (p.v - a.v) - (b.v - a.v) * (p.u - a.u)) / (Math.hypot(b.u - a.u, b.v - a.v) || 1);
        const constraint = Math.abs(side) < 1e-6 ? { type: "coincident", points: [pid, at(pid)] } : { type: "symmetric", points: [pid, at(pid)], entity: axis.id };
        sketch.constraints.push({ id: id++, auto: true, ...constraint });
      }
    }
  }
  return { sketch, selection: created };
}

/** Repeat the selection `count - 1` more times; `step(k)` is how copy k (1 for the first) is placed relative to the original. */
export function repeat(s: SketchData, sel: SketchSel[], count: number, step: (k: number) => { map: Map2; scale?: number }): EditResult {
  let sketch = s;
  const selection: SketchSel[] = [];
  for (let k = 1; k < count; k++) {
    const { map, scale } = step(k);
    const made = transform(sketch, sel, map, { copy: true, scale });
    sketch = made.sketch;
    selection.push(...made.selection);
  }
  return { sketch, selection };
}
