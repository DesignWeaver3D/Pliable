/** Which constraint and dimension buttons fit a selection of sketch points and curves, and what each builds. No DOM or WebGL.
 * Split out of sketchmodel.ts; that file re-exports everything here, so imports of it keep working. */
import { pointOf, entityOf, entityPoints, type SketchData, type SketchSel, type SketchEntity, type SketchConstraint } from "./sketchmodel.ts";

export interface ConstraintOption {
  label: string;
  /** Builds the constraint from the selection, or null if this option does not fit it. */
  build(s: SketchData, sel: SketchSel[]): Omit<SketchConstraint, "id"> | null;
  /** When the selection takes several constraints at once, all of them (applied as one undo step). Falls back to `build`. */
  buildMany?(s: SketchData, sel: SketchSel[]): Omit<SketchConstraint, "id">[];
  /** For the smart dimension: the specific dimension option the selection stands for (the dialog and the constraint come from it). */
  pick?(s: SketchData, sel: SketchSel[]): ConstraintOption | null;
  /** For dimensions: the value the dialog starts with, from the current geometry. */
  initial?(s: SketchData, sel: SketchSel[]): number;
  /** For the smart dimension: every constraint that fits the selection (`near`: how close two points must be to count as one place), for a menu next to the cursor when there are several. */
  choices?(s: SketchData, sel: SketchSel[], near: number): ConstraintOption[];
  dimension?: boolean;
}

export const entities = (s: SketchData, sel: SketchSel[]) => sel.filter((x) => x.kind === "entity").map((x) => entityOf(s, x.id)!);
export const pts = (sel: SketchSel[]) => sel.filter((x) => x.kind === "point").map((x) => x.id);
export const only = (list: SketchEntity[], ...types: string[]) => list.length > 0 && list.every((e) => types.includes(e.type));
export const dist = (s: SketchData, a: number, b: number) => Math.hypot(pointOf(s, a).u - pointOf(s, b).u, pointOf(s, a).v - pointOf(s, b).v);
const isRoundEntity = (e: SketchEntity): e is Extract<SketchEntity, { type: "circle" | "arc" }> => e.type === "circle" || e.type === "arc";
export const radiusOf = (s: SketchData, e: SketchEntity) => (e.type === "circle" ? e.radius : e.type === "arc" ? dist(s, e.center, e.start) : 0);

/** The two points a selection measures between: a line's ends, or two selected points. */
function ends(s: SketchData, sel: SketchSel[]): [number, number] {
  const line = entities(s, sel)[0];
  return line && line.type === "line" ? [line.a, line.b] : [pts(sel)[0], pts(sel)[1]];
}

/** Perpendicular distance from a point to the infinite line through a line entity. */
export function pointLineDistance(s: SketchData, pointId: number, line: Extract<SketchEntity, { type: "line" }>): number {
  const [a, b, p] = [pointOf(s, line.a), pointOf(s, line.b), pointOf(s, pointId)];
  const length = Math.hypot(b.u - a.u, b.v - a.v) || 1;
  return Math.abs((b.u - a.u) * (p.v - a.v) - (b.v - a.v) * (p.u - a.u)) / length;
}

/** The current value of a dimensional constraint, read from the geometry (what a reference dimension shows). */
export function measure(s: SketchData, c: SketchConstraint): number | null {
  const entity = entityOf(s, c.entity);
  const line = entity && entity.type === "line" ? entity : null;
  const ends = line ? [line.a, line.b] : c.points;
  switch (c.type) {
    case "distance":
      return ends ? dist(s, ends[0], ends[1]) : null;
    case "horizontal_distance":
      return ends ? Math.abs(pointOf(s, ends[0]).u - pointOf(s, ends[1]).u) : null;
    case "vertical_distance":
      return ends ? Math.abs(pointOf(s, ends[0]).v - pointOf(s, ends[1]).v) : null;
    case "radius":
      return entity ? radiusOf(s, entity) : null;
    case "minor_radius":
      return entity && entity.type === "ellipse" ? entity.minor : null;
    case "diameter":
      return entity ? 2 * radiusOf(s, entity) : null;
    case "point_line_distance":
      return line && c.point !== undefined ? pointLineDistance(s, c.point, line) : null;
    case "round_gap": {
      const [a, b] = (c.entities ?? []).map((id) => entityOf(s, id));
      if (!a || !b || !isRoundEntity(a) || !isRoundEntity(b)) return null;
      const [ca, cb] = [pointOf(s, a.center), pointOf(s, b.center)];
      const d = Math.hypot(ca.u - cb.u, ca.v - cb.v);
      const [ra, rb] = [radiusOf(s, a), radiusOf(s, b)];
      return d >= ra + rb ? d - ra - rb : d <= Math.abs(ra - rb) ? Math.abs(ra - rb) - d : 0;
    }
    case "angle": {
      const [a, b] = (c.entities ?? []).map((id) => entityOf(s, id));
      if (!a || !b || a.type !== "line" || b.type !== "line") return null;
      const d = (l: typeof a) => [pointOf(s, l.b).u - pointOf(s, l.a).u, pointOf(s, l.b).v - pointOf(s, l.a).v];
      const [da, db] = [d(a), d(b)];
      const inside = (Math.acos((da[0] * db[0] + da[1] * db[1]) / Math.hypot(...da) / Math.hypot(...db)) * 180) / Math.PI;
      return c.outside ? 180 - inside : inside;
    }
  }
  return null;
}

/** Which angle between two lines a point (a dragged value) sits in: true for the outside one, false for the inside one (between the line directions), null when the lines are parallel. */
export function angleSideOutside(s: SketchData, lines: [number, number], at: [number, number]): boolean | null {
  const [a, b] = lines.map((id) => entityOf(s, id));
  if (!a || !b || a.type !== "line" || b.type !== "line") return null;
  const [a0, a1, b0, b1] = [pointOf(s, a.a), pointOf(s, a.b), pointOf(s, b.a), pointOf(s, b.b)];
  const da = [a1.u - a0.u, a1.v - a0.v];
  const db = [b1.u - b0.u, b1.v - b0.v];
  const cross = (p: number[], q: number[]) => p[0] * q[1] - p[1] * q[0];
  const det = cross(da, db);
  if (Math.abs(det) < 1e-12 * (Math.hypot(...da) * Math.hypot(...db) || 1)) return null;
  // Where the two lines meet, then the point as a mix of the two directions from there: the same signs means the sector between the directions.
  const t = cross([b0.u - a0.u, b0.v - a0.v], db) / det;
  const meet = [a0.u + t * da[0], a0.v + t * da[1]];
  const v = [at[0] - meet[0], at[1] - meet[1]];
  return (cross(v, db) / det) * (cross(da, v) / det) < 0;
}

/** Every constraint an option adds for the selection: its several at once, or the single one when it has no several for this selection (a lone line gives none from `buildMany`). */
export function constraintsToAdd(option: ConstraintOption, s: SketchData, sel: SketchSel[]): Omit<SketchConstraint, "id">[] {
  const many = option.buildMany?.(s, sel) ?? [];
  if (many.length) return many;
  const one = option.build(s, sel);
  return one ? [one] : [];
}

type Line = Extract<SketchEntity, { type: "line" }>;

/** Symmetry for a selection of points and lines: two points about a line; three points (the first two opposite each other about the third, which is the fixed
 * one such as the origin, else the one nearest the others' middle); one line's ends about another line or an axis; two circles, arcs or ellipses (their centers) about a line or a point; two lines about a third line (the sketch axis or a construction line if there is one, else
 * the last selected), or about a point. The lines' ends are paired whichever way fits the drawn shape best. */
export function symmetries(s: SketchData, sel: SketchSel[]): Omit<SketchConstraint, "id">[] {
  const es = entities(s, sel);
  const p = pts(sel);
  const uv = (id: number) => pointOf(s, id);
  if (es.length === 1 && only(es, "line") && p.length === 2) return [{ type: "symmetric", points: p, entity: es[0].id }];
  if (!es.length && p.length === 3) {
    const offMiddle = (c: number) => {
      const [a, b] = p.filter((q) => q !== c).map(uv);
      return Math.hypot(uv(c).u - (a.u + b.u) / 2, uv(c).v - (a.v + b.v) / 2);
    };
    const centre = p.find((id) => uv(id).fixed) ?? [...p].sort((x, y) => offMiddle(x) - offMiddle(y))[0];
    return [{ type: "symmetric_point", points: p.filter((id) => id !== centre), point: centre }];
  }
  // Two circles, arcs or ellipses (their centers) about a line or a point, and one line (its two ends) about another line or an axis.
  const roundOf = es.filter((e) => e.type === "circle" || e.type === "arc" || e.type === "ellipse");
  const straight = es.filter((e) => e.type === "line") as Line[];
  if (roundOf.length === 2 && roundOf.length + straight.length === es.length && straight.length + p.length === 1) {
    const centres = roundOf.map((e) => (e as { center: number }).center);
    return straight.length ? [{ type: "symmetric", points: centres, entity: straight[0].id }] : [{ type: "symmetric_point", points: centres, point: p[0] }];
  }
  if (straight.length === 2 && es.length === 2 && !p.length) {
    const about = straight.find((l) => l.axis) ?? straight.find((l) => l.construction || l.reference) ?? straight[1];
    const mirrored = straight.find((l) => l !== about)!;
    return mirrored.reference ? [] : [{ type: "symmetric", points: [mirrored.a, mirrored.b], entity: about.id }];
  }
  if (!only(es, "line") || es.length < 2) return [];
  const lines = es as Line[];
  /** The two ways to pair the ends of two lines; the one with the smaller `gap` is used. */
  const pairings = (a: Line, b: Line): [number, number][][] => [[[a.a, b.a], [a.b, b.b]], [[a.a, b.b], [a.b, b.a]]];
  const best = (a: Line, b: Line, gap: (x: number, y: number) => number) => pairings(a, b).sort((m, n) => m.reduce((sum, [x, y]) => sum + gap(x, y), 0) - n.reduce((sum, [x, y]) => sum + gap(x, y), 0))[0];
  if (lines.length === 2 && p.length === 1) {
    const c = uv(p[0]);
    const pairs = best(lines[0], lines[1], (x, y) => Math.hypot((uv(x).u + uv(y).u) / 2 - c.u, (uv(x).v + uv(y).v) / 2 - c.v));
    return pairs.map(([x, y]) => ({ type: "symmetric_point", points: [x, y], point: p[0] }));
  }
  if (lines.length === 3 && !p.length) {
    const axis = lines.find((l) => l.axis) ?? lines.find((l) => l.construction || l.reference) ?? lines[2];
    const [a, b] = lines.filter((l) => l !== axis);
    const [o, d] = [uv(axis.a), uv(axis.b)];
    const length = Math.hypot(d.u - o.u, d.v - o.v) || 1;
    const mirrored = (x: number, y: number) => {
      const [q, r] = [uv(x), uv(y)];
      const along = ((q.u - o.u) * (d.u - o.u) + (q.v - o.v) * (d.v - o.v)) / (length * length);
      const foot = [o.u + along * (d.u - o.u), o.v + along * (d.v - o.v)];
      return Math.hypot(2 * foot[0] - q.u - r.u, 2 * foot[1] - q.v - r.v);
    };
    return best(a, b, mirrored).map(([x, y]) => ({ type: "symmetric", points: [x, y], entity: axis.id }));
  }
  return [];
}

/** The selected lines that may still take a horizontal or vertical constraint, when two or more lines are selected. */
function freeLines(s: SketchData, sel: SketchSel[]): Extract<SketchEntity, { type: "line" }>[] {
  const es = entities(s, sel);
  if (es.length < 2 || !only(es, "line")) return [];
  const held = (id: number) => s.constraints.some((c) => c.entity === id && (c.type === "horizontal" || c.type === "vertical"));
  return (es as Extract<SketchEntity, { type: "line" }>[]).filter((l) => !l.reference && !held(l.id));
}

/** Which points are already made coincident with each other (their groups), from the existing constraints. */
function coincidentGroups(s: SketchData): Map<number, number> {
  const root = new Map<number, number>();
  const find = (a: number): number => (root.get(a) ?? a) === a ? a : find(root.get(a)!);
  for (const c of s.constraints) if (c.type === "coincident" && c.points) root.set(find(c.points[0]), find(c.points[1]));
  return new Map(s.points.map((p) => [p.id, find(p.id)]));
}

/** Coincident for the selection: several points are joined to the first; points and curves put each point on each curve. */
export function coincidences(s: SketchData, sel: SketchSel[]): Omit<SketchConstraint, "id">[] {
  const p = pts(sel);
  const es = entities(s, sel);
  if (!es.length) {
    if (p.length < 2) return [];
    const groups = coincidentGroups(s);
    return p.slice(1).filter((q) => groups.get(q) !== groups.get(p[0])).map((q) => ({ type: "coincident", points: [p[0], q] }));
  }
  if (!p.length || !only(es, "line", "circle", "arc", "ellipse")) return [];
  return es.flatMap((e) => p.filter((q) => !entityPoints(e).includes(q) && !s.constraints.some((c) => c.type === "point_on" && c.point === q && c.entity === e.id)).map((q) => ({ type: "point_on", point: q, entity: e.id })));
}

/** Tangent or collinear, whichever fits the selection: lines are made collinear with the first; a curve and a line or curve are made tangent
 * (for more than two items, only those that meet at a point). */
export function tangentOrCollinear(s: SketchData, sel: SketchSel[]): Omit<SketchConstraint, "id">[] {
  const es = entities(s, sel);
  if (es.length < 2 || !only(es, "line", "arc", "circle")) return [];
  const has = (type: string, a: number, b: number) => s.constraints.some((c) => c.type === type && c.entities?.includes(a) && c.entities?.includes(b));
  if (es.every((e) => e.type === "line")) {
    return es.slice(1).filter((e) => !e.reference && !has("collinear", es[0].id, e.id)).map((e) => ({ type: "collinear", entities: [es[0].id, e.id] }));
  }
  const groups = coincidentGroups(s);
  const meet = (a: SketchEntity, b: SketchEntity) => entityPoints(a).some((p) => entityPoints(b).some((q) => groups.get(p) === groups.get(q)));
  const out: Omit<SketchConstraint, "id">[] = [];
  for (let i = 0; i < es.length; i++) {
    for (let j = i + 1; j < es.length; j++) {
      const [a, b] = [es[i], es[j]];
      if (a.type === "line" && b.type === "line") continue;
      if ((es.length === 2 || meet(a, b)) && !has("tangent", a.id, b.id)) out.push({ type: "tangent", entities: [a.id, b.id] });
    }
  }
  return out;
}

/** Whether a line lies nearer the horizontal (true) or the vertical axis of the sketch. */
function nearHorizontal(s: SketchData, l: Extract<SketchEntity, { type: "line" }>): boolean {
  const [a, b] = [pointOf(s, l.a), pointOf(s, l.b)];
  return Math.abs(b.u - a.u) >= Math.abs(b.v - a.v);
}

/** Horizontal or vertical for each selected line, whichever its slope is nearer to (one line, or several free ones). */
function autoAxis(s: SketchData, sel: SketchSel[]): Omit<SketchConstraint, "id">[] {
  const es = entities(s, sel);
  const lines = es.length === 1 && only(es, "line") && !es[0].reference ? [es[0] as Extract<SketchEntity, { type: "line" }>] : freeLines(s, sel);
  return lines.map((l) => ({ type: nearHorizontal(s, l) ? "horizontal" : "vertical", entity: l.id }));
}

/** The table that decides which constraint buttons appear for a selection. Edit here to add or reorder. */
export const CONSTRAINT_OPTIONS: ConstraintOption[] = [
  {
    label: "Horizontal / vertical",
    build: (s, sel) => autoAxis(s, sel)[0] ?? null,
    buildMany: autoAxis,
  },
  {
    label: "Horizontal",
    buildMany: (s, sel) => freeLines(s, sel).map((l) => ({ type: "horizontal", entity: l.id })),
    build: (s, sel) => {
      const many = freeLines(s, sel);
      if (many.length) return { type: "horizontal", entity: many[0].id };
      const es = entities(s, sel);
      if (es.length === 1 && only(es, "line")) return { type: "horizontal", entity: es[0].id };
      const p = pts(sel);
      return p.length === 2 && !es.length ? { type: "horizontal", points: p } : null;
    },
  },
  {
    label: "Vertical",
    buildMany: (s, sel) => freeLines(s, sel).map((l) => ({ type: "vertical", entity: l.id })),
    build: (s, sel) => {
      const many = freeLines(s, sel);
      if (many.length) return { type: "vertical", entity: many[0].id };
      const es = entities(s, sel);
      if (es.length === 1 && only(es, "line")) return { type: "vertical", entity: es[0].id };
      const p = pts(sel);
      return p.length === 2 && !es.length ? { type: "vertical", points: p } : null;
    },
  },
  {
    label: "Coincident",
    buildMany: (s, sel) => coincidences(s, sel),
    build: (s, sel) => coincidences(s, sel)[0] ?? null,
  },
  {
    label: "Fixed",
    build: (s, sel) => (pts(sel).length === 1 && !entities(s, sel).length ? { type: "fixed", point: pts(sel)[0] } : null),
  },
  {
    label: "Parallel",
    build: (s, sel) => {
      const es = entities(s, sel);
      return es.length === 2 && only(es, "line") ? { type: "parallel", entities: es.map((e) => e.id) } : null;
    },
  },
  {
    label: "Perpendicular",
    build: (s, sel) => {
      const es = entities(s, sel);
      return es.length === 2 && only(es, "line") ? { type: "perpendicular", entities: es.map((e) => e.id) } : null;
    },
  },
  {
    label: "Equal",
    build: (s, sel) => {
      const es = entities(s, sel);
      if (es.length !== 2) return null;
      const lines = es.filter((e) => e.type === "line").length;
      return (lines === 2 && !es.some((e) => e.reference && e.type === "line" && e.axis)) || lines === 0 ? { type: "equal", entities: es.map((e) => e.id) } : null;
    },
  },
  {
    label: "Tangent / collinear",
    buildMany: (s, sel) => tangentOrCollinear(s, sel),
    build: (s, sel) => tangentOrCollinear(s, sel)[0] ?? null,
  },
  {
    label: "Point on",
    build: (s, sel) => {
      const es = entities(s, sel);
      return es.length === 1 && pts(sel).length === 1 ? { type: "point_on", point: pts(sel)[0], entity: es[0].id } : null;
    },
  },
  {
    label: "Midpoint",
    build: (s, sel) => {
      const es = entities(s, sel);
      return es.length === 1 && only(es, "line") && !(es[0] as { axis?: boolean }).axis && pts(sel).length === 1 ? { type: "midpoint", point: pts(sel)[0], entity: es[0].id } : null;
    },
  },
  {
    label: "Lock",
    build: (s, sel) => {
      const es = entities(s, sel);
      return es.length === 1 && !es[0].reference ? { type: "block", entity: es[0].id } : null;
    },
  },
  {
    label: "Symmetric",
    build: (s, sel) => symmetries(s, sel)[0] ?? null,
    buildMany: symmetries,
  },
  {
    label: "Length / distance",
    dimension: true,
    build: (s, sel) => {
      const es = entities(s, sel);
      if (es.length === 1 && only(es, "line") && !pts(sel).length) return { type: "distance", entity: es[0].id };
      return pts(sel).length === 2 && !es.length ? { type: "distance", points: pts(sel) } : null;
    },
    initial: (s, sel) => {
      const es = entities(s, sel);
      const line = es[0];
      return line && line.type === "line" ? dist(s, line.a, line.b) : dist(s, pts(sel)[0], pts(sel)[1]);
    },
  },
  {
    label: "Point to line distance",
    dimension: true,
    build: (s, sel) => {
      const es = entities(s, sel);
      return es.length === 1 && only(es, "line") && pts(sel).length === 1 ? { type: "point_line_distance", point: pts(sel)[0], entity: es[0].id } : null;
    },
    initial: (s, sel) => {
      const line = entities(s, sel)[0] as Extract<SketchEntity, { type: "line" }>;
      return pointLineDistance(s, pts(sel)[0], line);
    },
  },
  {
    label: "Horizontal distance",
    dimension: true,
    build: (s, sel) => {
      const es = entities(s, sel);
      if (es.length === 1 && only(es, "line") && !pts(sel).length) return { type: "horizontal_distance", entity: es[0].id };
      return pts(sel).length === 2 && !es.length ? { type: "horizontal_distance", points: pts(sel) } : null;
    },
    initial: (s, sel) => {
      const [a, b] = ends(s, sel);
      return Math.abs(pointOf(s, a).u - pointOf(s, b).u);
    },
  },
  {
    label: "Vertical distance",
    dimension: true,
    build: (s, sel) => {
      const es = entities(s, sel);
      if (es.length === 1 && only(es, "line") && !pts(sel).length) return { type: "vertical_distance", entity: es[0].id };
      return pts(sel).length === 2 && !es.length ? { type: "vertical_distance", points: pts(sel) } : null;
    },
    initial: (s, sel) => {
      const [a, b] = ends(s, sel);
      return Math.abs(pointOf(s, a).v - pointOf(s, b).v);
    },
  },
  {
    label: "Short radius",
    dimension: true,
    build: (s, sel) => {
      const es = entities(s, sel);
      return es.length === 1 && only(es, "ellipse") ? { type: "minor_radius", entity: es[0].id } : null;
    },
    initial: (s, sel) => (entities(s, sel)[0] as Extract<SketchEntity, { type: "ellipse" }>).minor,
  },
  {
    label: "Radius",
    dimension: true,
    build: (s, sel) => {
      const es = entities(s, sel);
      return es.length === 1 && only(es, "circle", "arc") ? { type: "radius", entity: es[0].id } : null;
    },
    initial: (s, sel) => radiusOf(s, entities(s, sel)[0]),
  },
  {
    label: "Diameter",
    dimension: true,
    build: (s, sel) => {
      const es = entities(s, sel);
      return es.length === 1 && only(es, "circle", "arc") ? { type: "diameter", entity: es[0].id } : null;
    },
    initial: (s, sel) => 2 * radiusOf(s, entities(s, sel)[0]),
  },
  {
    label: "Angle",
    dimension: true,
    build: (s, sel) => {
      const es = entities(s, sel);
      return es.length === 2 && only(es, "line") ? { type: "angle", entities: es.map((e) => e.id) } : null;
    },
    initial: (s, sel) => {
      const [a, b] = entities(s, sel) as Extract<SketchEntity, { type: "line" }>[];
      const d = (l: typeof a) => [pointOf(s, l.b).u - pointOf(s, l.a).u, pointOf(s, l.b).v - pointOf(s, l.a).v];
      const [da, db] = [d(a), d(b)];
      const angle = (Math.acos((da[0] * db[0] + da[1] * db[1]) / Math.hypot(...da) / Math.hypot(...db)) * 180) / Math.PI;
      return Math.round(angle * 1000) / 1000;
    },
  },
];
