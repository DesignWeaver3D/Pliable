/** Geometry for the sketch tools that need more than a click-to-point mapping: arcs and circles through three points, and slots. No DOM. */

export interface UV {
  u: number;
  v: number;
}

/** Centre and radius of the circle through three points, or null when they are (nearly) on one line. */
export function circumcircle(a: UV, b: UV, c: UV): { u: number; v: number; radius: number } | null {
  const d = 2 * (a.u * (b.v - c.v) + b.u * (c.v - a.v) + c.u * (a.v - b.v));
  const scale = Math.hypot(b.u - a.u, b.v - a.v) * Math.hypot(c.u - a.u, c.v - a.v);
  if (Math.abs(d) < 1e-9 * (scale || 1)) return null;
  const [sa, sb, sc] = [a.u * a.u + a.v * a.v, b.u * b.u + b.v * b.v, c.u * c.u + c.v * c.v];
  const u = (sa * (b.v - c.v) + sb * (c.v - a.v) + sc * (a.v - b.v)) / d;
  const v = (sa * (c.u - b.u) + sb * (a.u - c.u) + sc * (b.u - a.u)) / d;
  return { u, v, radius: Math.hypot(a.u - u, a.v - v) };
}

/**
 * The counterclockwise arc from `start` through `through` to `end`: its centre and which of the two ends it runs
 * from. Arcs always run counterclockwise, so when the three points turn clockwise the ends swap roles.
 */
export function arcThrough(start: UV, through: UV, end: UV): { centre: UV; from: "start" | "end"; radius: number } | null {
  const circle = circumcircle(start, through, end);
  if (!circle) return null;
  const turn = (through.u - start.u) * (end.v - through.v) - (through.v - start.v) * (end.u - through.u);
  return { centre: { u: circle.u, v: circle.v }, from: turn > 0 ? "start" : "end", radius: circle.radius };
}

/**
 * A slot from end centre `a` to end centre `b` with the given half-width: the four tangent points and the two
 * arcs' counterclockwise ends. Lines run a-side to b-side along each edge.
 */
export function slotCorners(a: UV, b: UV, halfWidth: number): { aLeft: UV; aRight: UV; bLeft: UV; bRight: UV } | null {
  const length = Math.hypot(b.u - a.u, b.v - a.v);
  if (length < 1e-9 || halfWidth < 1e-9) return null;
  const [nu, nv] = [(-(b.v - a.v) / length) * halfWidth, ((b.u - a.u) / length) * halfWidth];
  return {
    aLeft: { u: a.u + nu, v: a.v + nv },
    aRight: { u: a.u - nu, v: a.v - nv },
    bLeft: { u: b.u + nu, v: b.v + nv },
    bRight: { u: b.u - nu, v: b.v - nv },
  };
}

/** Distance from a point to the infinite line through a and b: the slot's half-width from the third click. */
export function distanceToAxis(a: UV, b: UV, p: UV): number {
  const length = Math.hypot(b.u - a.u, b.v - a.v) || 1;
  return Math.abs((b.u - a.u) * (p.v - a.v) - (b.v - a.v) * (p.u - a.u)) / length;
}
