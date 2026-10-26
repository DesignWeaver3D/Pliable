/** The Split tool on an ellipse or an elliptical arc (an ellipse with start and end points): a whole ellipse is cut open at the point into one arc
 *  that starts and ends there; an arc is cut into two that share the point, the first keeping the arc's id. The pieces share the ellipse's axis end
 *  points, so they stay one ellipse (the solver holds each end on it). No DOM. */
import { ellipseAngle, ellipseFrame, ellipsePoint, ellipseSweep } from "./sketchellipse.ts";
import type { EditResult } from "./sketchedit.ts";
import { nextId, pointOf } from "./sketchmodel.ts";
import type { SketchData, SketchEntity } from "./sketchmodel.ts";

type Ellipse = Extract<SketchEntity, { type: "ellipse" }>;

function frameOf(s: SketchData, e: Ellipse) {
  const c = pointOf(s, e.center);
  const m = pointOf(s, e.minor1!);
  return ellipseFrame(c, pointOf(s, e.major), Math.hypot(m.u - c.u, m.v - c.v));
}

/** Cut ellipse `id` where the click (u, v) is, or at the existing point `atPoint` that lies on it. Null when it cannot be cut there: a reference or
 *  an ellipse without axis end points (an old file), or a click too near an end of the arc. */
export function splitEllipse(s: SketchData, id: number, u: number, v: number, margin = 0.02, atPoint?: number): EditResult | null {
  const e = s.entities.find((x) => x.id === id);
  if (!e || e.type !== "ellipse" || e.reference || e.minor1 === undefined) return null;
  const f = frameOf(s, e);
  const t = ellipseAngle(f, u, v);
  let next = nextId(s);
  let middle = atPoint;
  let points = s.points;
  if (e.start !== undefined) {
    const from = ellipseAngle(f, pointOf(s, e.start).u, pointOf(s, e.start).v);
    const sweep = ellipseSweep(from, ellipseAngle(f, pointOf(s, e.end!).u, pointOf(s, e.end!).v));
    const along = ellipseSweep(from, t) % (2 * Math.PI);
    if (along < margin * sweep || along > (1 - margin) * sweep) return null; // outside the arc, or too near an end to cut
  }
  if (middle === undefined) {
    middle = next++;
    const [pu, pv] = ellipsePoint(f, t);
    points = [...s.points, { id: middle, u: pu, v: pv }];
  }
  const second = next++;
  const entities = s.entities.flatMap((x): SketchEntity[] => {
    if (x.id !== id) return [x];
    const rest = e.start === undefined ? e.start : e.end;
    const whole = e.start === undefined;
    const first: Ellipse = { ...e, start: whole ? middle : e.start, end: middle };
    if (whole) return [first]; // one arc, from the cut round to the cut
    return [first, { ...e, id: second, start: middle, end: rest }];
  });
  // The point's own "on the ellipse" constraint is now the cut itself.
  const constraints = s.constraints.filter((c) => !(atPoint !== undefined && c.type === "point_on" && c.point === atPoint && c.entity === id));
  return { sketch: { ...s, points, entities, constraints }, selection: [{ kind: "entity", id }, ...(e.start !== undefined ? [{ kind: "entity" as const, id: second }] : [])] };
}

/** The ellipse (with axis end points, so it can be cut) a point lies on, for cutting it there: the one its point-on constraint names, else any
 *  the point touches without being an end of an arc. Null when there is none. */
export function ellipseThroughPoint(s: SketchData, pointId: number): number | null {
  const p = s.points.find((q) => q.id === pointId);
  if (!p) return null;
  const named = s.constraints.find((c) => c.type === "point_on" && c.point === pointId && c.entity !== undefined);
  for (const e of named ? s.entities.filter((x) => x.id === named.entity) : s.entities) {
    if (e.type !== "ellipse" || e.reference || e.minor1 === undefined || e.start === pointId || e.end === pointId) continue;
    const f = frameOf(s, e);
    const [qu, qv] = ellipsePoint(f, ellipseAngle(f, p.u, p.v));
    if (Math.hypot(p.u - qu, p.v - qv) < 1e-6 * f.a + 1e-9) return e.id;
  }
  return null;
}
