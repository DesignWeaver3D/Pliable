/** The smart dimension: one button (and the D key) that offers every constraint or dimension that fits whatever is selected.
 *  One fit is applied at once; several are chosen from a small menu next to the cursor. Rules and answers: docs/archive/smart-dimension-plan.md. No DOM. */
import { CONSTRAINT_OPTIONS, coincidences, dist, entities, measure, only, pointLineDistance, pts, radiusOf, type ConstraintOption } from "./sketchconstraints.ts";
import { distanceTo, entityPoints, pointOf, type SketchConstraint, type SketchData, type SketchEntity, type SketchSel } from "./sketchmodel.ts";

type Line = Extract<SketchEntity, { type: "line" }>;
type Ellipse = Extract<SketchEntity, { type: "ellipse" }>;
type Build = Omit<SketchConstraint, "id">;

const named = (label: string) => CONSTRAINT_OPTIONS.find((o) => o.label === label)!;
const centreOf = (e: SketchEntity) => (e.type === "circle" || e.type === "arc" || e.type === "ellipse" ? e.center : undefined);
const isRound = (e: SketchEntity) => e.type === "circle" || e.type === "arc";
const entityHas = (e: SketchEntity, point: number) => [e.type === "line" ? e.a : -1, e.type === "line" ? e.b : -1, centreOf(e) ?? -1].includes(point);

/** A fit that is a dimension: `build` names it, `initial` is the value it starts from. */
function dimension(label: string, build: (s: SketchData, sel: SketchSel[]) => Build | null, initial: (s: SketchData, sel: SketchSel[]) => number): ConstraintOption {
  return { label, dimension: true, build, initial };
}

/** A fit that is a plain constraint (or several made at once). */
function constraint(label: string, many: (s: SketchData, sel: SketchSel[]) => Build[]): ConstraintOption {
  return { label, build: (s, sel) => many(s, sel)[0] ?? null, buildMany: many };
}

/** Two lines that run the same way: already constrained parallel, or within a degree of it. */
export function areParallel(s: SketchData, a: Line, b: Line): boolean {
  if (s.constraints.some((c) => c.type === "parallel" && c.entities?.includes(a.id) && c.entities?.includes(b.id))) return true;
  const d = (l: Line) => [pointOf(s, l.b).u - pointOf(s, l.a).u, pointOf(s, l.b).v - pointOf(s, l.a).v];
  const [da, db] = [d(a), d(b)];
  return Math.abs(da[0] * db[1] - da[1] * db[0]) / (Math.hypot(...da) * Math.hypot(...db) || 1) < Math.sin(Math.PI / 180);
}

/** A distance from a point to a line, with the point and line taken from the selection. */
const pointLine = (label: string, pointOfSel: (s: SketchData, sel: SketchSel[]) => number | undefined, lineOfSel: (s: SketchData, sel: SketchSel[]) => Line | undefined) =>
  dimension(
    label,
    (s, sel) => {
      const [p, l] = [pointOfSel(s, sel), lineOfSel(s, sel)];
      return p !== undefined && l && !entityHas(l, p) ? { type: "point_line_distance", point: p, entity: l.id } : null;
    },
    (s, sel) => pointLineDistance(s, pointOfSel(s, sel)!, lineOfSel(s, sel)!),
  );

const centres = (s: SketchData, sel: SketchSel[]) => entities(s, sel).map((e) => centreOf(e)!);

/** Every constraint or dimension that fits the selection, most useful first. `near`: how close (model units) two points or a point and a curve must be to count as the same place. */
export function smartChoices(s: SketchData, sel: SketchSel[], near: number): ConstraintOption[] {
  const es = entities(s, sel);
  const ps = pts(sel);
  const total = es.length + ps.length;
  if (!total || (!ps.length && es.every((e) => e.reference))) return []; // projected edges can be constrained to, but a selection of only those has nothing free to constrain
  const out: ConstraintOption[] = [];
  const add = (o: ConstraintOption) => {
    if (o.build(s, sel)) out.push(o);
  };

  if (total === 1) {
    const e = es[0];
    if (!e) return out;
    if (e.type === "line") add(named("Length / distance"));
    else if (e.type === "circle") add(named("Diameter"));
    else if (e.type === "arc") add(named("Radius"));
    else if (e.type === "ellipse" && e.minor1 === undefined) add(named("Short radius"));
    else if (e.type === "ellipse") {
      // the widths are the distances between the opposite ends of the two axes
      add(dimension("Major width", (s2, sel2) => ({ type: "distance", points: [(entities(s2, sel2)[0] as Ellipse).major, (entities(s2, sel2)[0] as Ellipse).major2!] }), (s2, sel2) => dist(s2, (entities(s2, sel2)[0] as Ellipse).major, (entities(s2, sel2)[0] as Ellipse).major2!)));
      add(dimension("Minor width", (s2, sel2) => ({ type: "distance", points: [(entities(s2, sel2)[0] as Ellipse).minor1!, (entities(s2, sel2)[0] as Ellipse).minor2!] }), (s2, sel2) => dist(s2, (entities(s2, sel2)[0] as Ellipse).minor1!, (entities(s2, sel2)[0] as Ellipse).minor2!)));
    }
    return out;
  }

  if (total === 2) {
    if (ps.length === 2) {
      if (dist(s, ps[0], ps[1]) <= near) add(constraint("Coincident", coincidences));
      else add(named("Length / distance")); // the horizontal and vertical distances have their own buttons
    } else if (es.length === 2) {
      const [a, b] = es;
      if (a.type === "line" && b.type === "line") {
        if (areParallel(s, a, b)) add(pointLine("Distance between the lines", (s2, sel2) => (entities(s2, sel2)[0] as Line).a, (s2, sel2) => entities(s2, sel2)[1] as Line));
        else add(named("Angle"));
      } else if (isRound(a) && isRound(b)) {
        const [ca, cb] = [pointOf(s, centreOf(a)!), pointOf(s, centreOf(b)!)];
        if (Math.hypot(ca.u - cb.u, ca.v - cb.v) <= near) {
          add(constraint("Concentric", (s2, sel2) => {
            const [x, y] = centres(s2, sel2);
            return x === y ? [] : [{ type: "coincident", points: [x, y] }];
          }));
        } else {
          add(dimension("Distance between the centres", (s2, sel2) => ({ type: "distance", points: centres(s2, sel2) }), (s2, sel2) => dist(s2, centres(s2, sel2)[0], centres(s2, sel2)[1])));
        }
        // The spacing between the rims (also for concentric or nested circles), when the two do not overlap.
        const gap = (s2: SketchData, sel2: SketchSel[]) => measure(s2, { id: 0, type: "round_gap", entities: entities(s2, sel2).map((e) => e.id) });
        if ((gap(s, sel) ?? 0) > 1e-9) add(dimension("Gap between the rims", (s2, sel2) => ({ type: "round_gap", entities: entities(s2, sel2).map((e) => e.id) }), (s2, sel2) => Math.round((gap(s2, sel2) ?? 0) * 1000) / 1000));
      } else if (es.some((e) => e.type === "line") && es.some(isRound)) {
        add(pointLine("Centre to line distance", (s2, sel2) => centreOf(entities(s2, sel2).find(isRound)!), (s2, sel2) => entities(s2, sel2).find((e) => e.type === "line") as Line));
      }
    } else {
      const [e, p] = [es[0], ps[0]];
      if (e.type === "line" && !entityHas(e, p)) {
        add(named("Point to line distance"));
        if (pointLineDistance(s, p, e) <= near) add(named("Point on"));
      } else if (isRound(e) && !entityHas(e, p)) {
        const centre = centreOf(e)!;
        if (dist(s, p, centre) <= near) add(constraint("Coincident with the centre", () => [{ type: "coincident", points: [p, centre] }]));
        else add(dimension("Distance to the centre", () => ({ type: "distance", points: [p, centre] }), () => dist(s, p, centre)));
        if (Math.abs(dist(s, p, centre) - radiusOf(s, e)) <= near) add(named("Point on"));
      } else if (e.type === "ellipse" && !entityPoints(e).includes(p) && distanceTo(s, e, pointOf(s, p).u, pointOf(s, p).v) <= near) {
        add(named("Point on"));
      }
    }
    return out;
  }

  // Three or more items: only constraints that take that many arguments.
  const lineFirst = es[0];
  if (named("Symmetric").build(s, sel)) add(named("Symmetric"));
  if (es.length === 1 && lineFirst.type === "line" && ps.length >= 2) add(constraint("Midpoint", (s2, sel2) => pts(sel2).map((p) => ({ type: "midpoint", point: p, entity: entities(s2, sel2)[0].id }))));
  // Coincident only for points that are already together; far-apart points are not pulled onto one place.
  if (ps.length >= 3 && !es.length && ps.every((p) => dist(s, p, ps[0]) <= near)) add(constraint("Coincident", coincidences));
  const chain = (type: string) => (s2: SketchData, sel2: SketchSel[]): Build[] => entities(s2, sel2).slice(1).map((e) => ({ type, entities: [entities(s2, sel2)[0].id, e.id] }));
  if (es.length >= 3 && !ps.length && only(es, "line")) {
    add(constraint("Equal length", chain("equal")));
    add(constraint("Collinear", chain("collinear")));
  }
  if (es.length >= 3 && !ps.length && only(es, "circle", "arc")) {
    add(constraint("Equal radius", chain("equal")));
    add(constraint("Concentric", (s2, sel2) => {
      const c = centres(s2, sel2);
      return c.slice(1).filter((x) => x !== c[0]).map((x) => ({ type: "coincident", points: [c[0], x] }));
    }));
  }
  return out;
}

/** The smart dimension button: enabled when anything fits; applying it applies the one fit, or the one chosen from the cursor menu. */
export const SMART_DIMENSION: ConstraintOption = {
  label: "Dimension",
  dimension: true,
  choices: smartChoices,
  pick: (s, sel) => smartChoices(s, sel, 0)[0] ?? null,
  build: (s, sel) => smartChoices(s, sel, 0)[0]?.build(s, sel) ?? null,
  initial: (s, sel) => smartChoices(s, sel, 0)[0]?.initial?.(s, sel) ?? 0,
};

/** Constraint options that fit a selection. */
export function optionsFor(s: SketchData, sel: SketchSel[]): ConstraintOption[] {
  return sel.length === 0 ? [] : [SMART_DIMENSION, ...CONSTRAINT_OPTIONS].filter((o) => o.build(s, sel) !== null);
}

/** Buttons the smart dimension replaces: each one's constraint is reached by a selection the smart dimension handles (tested in sketchsmartdim.test.mjs; the audit is in docs/archive/smart-dimension-plan.md). */
export const ABSORBED_BY_SMART: Record<string, string> = {
  "Length / distance": "one line, or two separated points",
  "Short radius": "one ellipse",
  "Point to line distance": "a point and a line",
};

/** Every constraint and dimension button for the sketch strip (the smart dimension first), each with whether the current selection takes it. */
export function allConstraintOptions(s: SketchData, sel: SketchSel[]): { option: ConstraintOption; enabled: boolean }[] {
  return [SMART_DIMENSION, ...CONSTRAINT_OPTIONS.filter((o) => !(o.label in ABSORBED_BY_SMART))].map((option) => ({ option, enabled: sel.length > 0 && option.build(s, sel) !== null }));
}
