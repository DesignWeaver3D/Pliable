/** Ellipse geometry in sketch coordinates, no DOM and no sketch data: the frame of an ellipse (centre, unit major direction, radii), the angle of a
 *  point on it (the angle on the circle it is stretched from) and the point at an angle. An elliptical arc runs counterclockwise between two such angles. */
export interface EllipseFrame {
  u: number;
  v: number;
  /** Unit direction of the major semi-axis `a` (the clicked axis end); the minor semi-axis `b` is square to it, to its left. */
  ux: number;
  uy: number;
  a: number;
  b: number;
}

export function ellipseFrame(centre: { u: number; v: number }, major: { u: number; v: number }, minor: number): EllipseFrame {
  const a = Math.hypot(major.u - centre.u, major.v - centre.v) || 1e-9;
  return { u: centre.u, v: centre.v, ux: (major.u - centre.u) / a, uy: (major.v - centre.v) / a, a, b: minor };
}

/** The point of the ellipse at angle `t`. */
export function ellipsePoint(f: EllipseFrame, t: number): [number, number] {
  const x = f.a * Math.cos(t);
  const y = f.b * Math.sin(t);
  return [f.u + x * f.ux - y * f.uy, f.v + x * f.uy + y * f.ux];
}

/** The angle of the ellipse point nearest in direction to (u, v): the pointer need not be on the curve. */
export function ellipseAngle(f: EllipseFrame, u: number, v: number): number {
  const [du, dv] = [u - f.u, v - f.v];
  return Math.atan2((-du * f.uy + dv * f.ux) / (f.b || 1e-9), (du * f.ux + dv * f.uy) / f.a);
}

/** The counterclockwise sweep from angle `from` to angle `to`, in (0, 2 pi]. */
export function ellipseSweep(from: number, to: number): number {
  const turn = (((to - from) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return turn || 2 * Math.PI;
}

/** The signed sweep from `from` to `to` the short way round, in (-pi, pi]: which way the pointer moved from the start. */
export function ellipseSweepToward(from: number, to: number): number {
  const turn = to - from;
  return turn - 2 * Math.PI * Math.round(turn / (2 * Math.PI));
}

/** The points along an elliptical arc from angle `from` for `sweep` radians. */
export function ellipseArcPoints(f: EllipseFrame, from: number, sweep: number, segments: number): [number, number][] {
  return Array.from({ length: segments + 1 }, (_, i) => ellipsePoint(f, from + (sweep * i) / segments));
}
