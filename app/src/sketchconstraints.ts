/** Which constraint and dimension buttons fit a selection of sketch points and curves, and what each builds. No DOM or WebGL.
 * Split out of sketchmodel.ts; that file re-exports everything here, so imports of it keep working. */
import { pointOf, entityPoints, type SketchData, type SketchSel, type SketchEntity, type SketchConstraint } from "./sketchmodel.ts";

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
  dimension?: boolean;
}

const entities = (s: SketchData, sel: SketchSel[]) => sel.filter((x) => x.kind === "entity").map((x) => s.entities.find((e) => e.id === x.id)!);
const pts = (sel: SketchSel[]) => sel.filter((x) => x.kind === "point").map((x) => x.id);
const only = (list: SketchEntity[], ...types: string[]) => list.length > 0 && list.every((e) => types.includes(e.type));
const dist = (s: SketchData, a: number, b: number) => Math.hypot(pointOf(s, a).u - pointOf(s, b).u, pointOf(s, a).v - pointOf(s, b).v);
export const radiusOf = (s: SketchData, e: SketchEntity) => (e.type === "circle" ? e.radius : e.type === "arc" ? dist(s, e.center, e.start) : 0);

/** The two points a selection measures between: a line's ends, or two selected points. */
function ends(s: SketchData, sel: SketchSel[]): [number, number] {
  const line = entities(s, sel)[0];
  return line && line.type === "line" ? [line.a, line.b] : [pts(sel)[0], pts(sel)[1]];
}

/** Perpendicular distance from a point to the infinite line through a line entity. */
function pointLineDistance(s: SketchData, pointId: number, line: Extract<SketchEntity, { type: "line" }>): number {
  const [a, b, p] = [pointOf(s, line.a), pointOf(s, line.b), pointOf(s, pointId)];
  const length = Math.hypot(b.u - a.u, b.v - a.v) || 1;
  return Math.abs((b.u - a.u) * (p.v - a.v) - (b.v - a.v) * (p.u - a.u)) / length;
}

/** The current value of a dimensional constraint, read from the geometry (what a reference dimension shows). */
export function measure(s: SketchData, c: SketchConstraint): number | null {
  const entity = s.entities.find((e) => e.id === c.entity);
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
    case "axis_angle": {
      if (!line) return null;
      const [a, b] = [pointOf(s, line.a), pointOf(s, line.b)];
      return (Math.acos((b.u - a.u) / (Math.hypot(b.u - a.u, b.v - a.v) || 1)) * 180) / Math.PI;
    }
    case "angle": {
      const [a, b] = (c.entities ?? []).map((id) => s.entities.find((e) => e.id === id));
      if (!a || !b || a.type !== "line" || b.type !== "line") return null;
      const d = (l: typeof a) => [pointOf(s, l.b).u - pointOf(s, l.a).u, pointOf(s, l.b).v - pointOf(s, l.a).v];
      const [da, db] = [d(a), d(b)];
      return (Math.acos((da[0] * db[0] + da[1] * db[1]) / Math.hypot(...da) / Math.hypot(...db)) * 180) / Math.PI;
    }
  }
  return null;
}

/** Every constraint an option adds for the selection: its several at once, or the single one when it has no several for this selection (a lone line gives none from `buildMany`). */
export function constraintsToAdd(option: ConstraintOption, s: SketchData, sel: SketchSel[]): Omit<SketchConstraint, "id">[] {
  const many = option.buildMany?.(s, sel) ?? [];
  if (many.length) return many;
  const one = option.build(s, sel);
  return one ? [one] : [];
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
function coincidences(s: SketchData, sel: SketchSel[]): Omit<SketchConstraint, "id">[] {
  const p = pts(sel);
  const es = entities(s, sel);
  if (!es.length) {
    if (p.length < 2) return [];
    const groups = coincidentGroups(s);
    return p.slice(1).filter((q) => groups.get(q) !== groups.get(p[0])).map((q) => ({ type: "coincident", points: [p[0], q] }));
  }
  if (!p.length || !only(es, "line", "circle", "arc")) return [];
  return es.flatMap((e) => p.filter((q) => !entityPoints(e).includes(q) && !s.constraints.some((c) => c.type === "point_on" && c.point === q && c.entity === e.id)).map((q) => ({ type: "point_on", point: q, entity: e.id })));
}

/** Tangent or collinear, whichever fits the selection: lines are made collinear with the first; a curve and a line or curve are made tangent
 * (for more than two items, only those that meet at a point). */
function tangentOrCollinear(s: SketchData, sel: SketchSel[]): Omit<SketchConstraint, "id">[] {
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

/** The table that decides which constraint buttons appear for a selection. Edit here to add or reorder. */
export const CONSTRAINT_OPTIONS: ConstraintOption[] = [
  {
    label: "Horizontal / vertical",
    build: (s, sel) => {
      const l = freeLines(s, sel)[0];
      return l ? { type: nearHorizontal(s, l) ? "horizontal" : "vertical", entity: l.id } : null;
    },
    buildMany: (s, sel) => freeLines(s, sel).map((l) => ({ type: nearHorizontal(s, l) ? "horizontal" : "vertical", entity: l.id })),
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
      return lines === 2 || lines === 0 ? { type: "equal", entities: es.map((e) => e.id) } : null;
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
      return es.length === 1 && only(es, "line") && pts(sel).length === 1 ? { type: "midpoint", point: pts(sel)[0], entity: es[0].id } : null;
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
    build: (s, sel) => {
      const es = entities(s, sel);
      return es.length === 1 && only(es, "line") && pts(sel).length === 2 ? { type: "symmetric", points: pts(sel), entity: es[0].id } : null;
    },
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
    label: "Angle to horizontal axis",
    dimension: true,
    build: (s, sel) => {
      const es = entities(s, sel);
      return es.length === 1 && only(es, "line") ? { type: "axis_angle", entity: es[0].id } : null;
    },
    initial: (s, sel) => Math.round(measure(s, { id: 0, type: "axis_angle", entity: entities(s, sel)[0].id })! * 1000) / 1000,
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

/** The smart dimension: one button that dimensions whatever is selected. A line or two points: length; an arc: radius; a circle: diameter;
 * two lines: the angle between them; a point and a line: the distance from the point to the line; an ellipse: its short radius. */
const SMART_ORDER = ["Length / distance", "Radius", "Diameter", "Angle", "Point to line distance", "Short radius"];
const SMART_DIMENSION: ConstraintOption = {
  label: "Dimension",
  dimension: true,
  pick: (s, sel) => {
    const es = entities(s, sel);
    const circle = es.length === 1 && es[0].type === "circle";
    for (const label of SMART_ORDER) {
      if (label === "Radius" && circle) continue; // a circle is dimensioned by its diameter
      if (label === "Diameter" && !circle) continue; // an arc by its radius
      const option = CONSTRAINT_OPTIONS.find((o) => o.label === label)!;
      if (option.build(s, sel)) return option;
    }
    return null;
  },
  build: (s, sel) => SMART_DIMENSION.pick!(s, sel)?.build(s, sel) ?? null,
  initial: (s, sel) => SMART_DIMENSION.pick!(s, sel)!.initial!(s, sel),
};

/** Constraint options that fit a selection. */
export function optionsFor(s: SketchData, sel: SketchSel[]): ConstraintOption[] {
  return sel.length === 0 ? [] : [...CONSTRAINT_OPTIONS, SMART_DIMENSION].filter((o) => o.build(s, sel) !== null);
}

/** Every constraint and dimension button for the sketch strip, each with whether the current selection takes it. */
export function allConstraintOptions(s: SketchData, sel: SketchSel[]): { option: ConstraintOption; enabled: boolean }[] {
  return [...CONSTRAINT_OPTIONS, SMART_DIMENSION].map((option) => ({ option, enabled: sel.length > 0 && option.build(s, sel) !== null }));
}
