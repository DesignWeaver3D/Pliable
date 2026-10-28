/** Switch a Fixed point between pinned and held by its distances to the sketch axes (two dimensions from the origin). No DOM or WebGL. */
import { nextId, type SketchData, type SketchConstraint } from "./sketchmodel.ts";
import { showNumber } from "./precision.ts";

const round = (x: number) => parseFloat(showNumber(x));
const originOf = (s: SketchData) => s.points.find((p) => p.fixed && Math.hypot(p.u, p.v) < 1e-6);
const isAxisDistance = (c: SketchConstraint, origin: number, point: number) =>
  (c.type === "horizontal_distance" || c.type === "vertical_distance" || c.type === "horizontal" || c.type === "vertical") && !!c.points && c.points.includes(origin) && c.points.includes(point);

/** The constraints with this Fixed one replaced by the point's horizontal and vertical distance from the sketch origin; null when it cannot be (no origin, or the point is the origin). */
export function fixedToAxes(s: SketchData, id: number): SketchConstraint[] | null {
  const fixed = s.constraints.find((c) => c.id === id && c.type === "fixed");
  const origin = originOf(s);
  const point = s.points.find((p) => p.id === fixed?.point);
  if (!fixed || !origin || !point || point.id === origin.id) return null;
  const next = nextId(s);
  // A point on an axis is held to it with a plain horizontal or vertical constraint instead of a zero distance.
  const across = Math.abs(point.u) < 1e-9 ? { type: "vertical" } : { type: "horizontal_distance", value: round(Math.abs(point.u)) };
  const along = Math.abs(point.v) < 1e-9 ? { type: "horizontal" } : { type: "vertical_distance", value: round(Math.abs(point.v)) };
  return [...s.constraints.filter((c) => c.id !== id), { id: next, points: [origin.id, point.id], ...across }, { id: next + 1, points: [origin.id, point.id], ...along }];
}

/** The constraints with the point's axis distances replaced by one Fixed constraint; null when `id` is not one of such a pair. */
export function axesToFixed(s: SketchData, id: number): SketchConstraint[] | null {
  const origin = originOf(s);
  const c = s.constraints.find((x) => x.id === id);
  if (!origin || !c?.points || !c.points.includes(origin.id)) return null;
  const point = c.points.find((p) => p !== origin.id)!;
  const pair = s.constraints.filter((x) => isAxisDistance(x, origin.id, point));
  if (pair.length < 2 || !pair.includes(c)) return null;
  return [...s.constraints.filter((x) => !pair.includes(x)), { id: nextId(s), type: "fixed", point }];
}
