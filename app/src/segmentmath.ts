/** Nearest point on a line segment, in one place for every pick and snap that measures a cursor against a segment in 2D (sketch units or screen pixels). */
export type SegmentHit = { t: number; x: number; y: number; dist: number };

/**
 * Where along a 3D segment (0 at a, 1 at b) the point lies that shows at screen fraction `t` of its projection, for a
 * perspective camera: the picture of a line is not evenly spaced along it, the nearer half takes up more of the screen.
 * `depthA` and `depthB` are the distances of the ends along the viewing direction. Returns `t` unchanged when a depth
 * is not positive (an end at or behind the camera), and use `t` as it is for an orthographic camera.
 */
export function worldFraction(t: number, depthA: number, depthB: number): number {
  if (!(depthA > 0) || !(depthB > 0)) return t;
  const near = (1 - t) / depthA;
  const far = t / depthB;
  return far / (near + far);
}

/**
 * Projects (px, py) onto the segment a-b with the position along it clamped to [0, 1] (ends included).
 * A segment whose squared length is 0, or below `minLength2` when given, counts as a point at a (t = 0).
 */
export function projectOnSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number, minLength2 = 0): SegmentHit {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 || len2 < minLength2 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const x = ax + t * dx;
  const y = ay + t * dy;
  return { t, x, y, dist: Math.hypot(px - x, py - y) };
}
