// Pure tests for box selection on projected (screen) geometry. A window box (left to right) takes only
// items entirely inside the rectangle; a crossing box (right to left) takes every item inside or touched by it.

export interface P2 {
  x: number;
  y: number;
}
export interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export const pointInRect = (p: P2, r: Rect): boolean => p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;

/** Whether the screen segment p-q touches the rectangle (Liang-Barsky clipping). */
export function segmentHitsRect(p: P2, q: P2, r: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const clips: Array<[number, number]> = [
    [-dx, p.x - r.x0],
    [dx, r.x1 - p.x],
    [-dy, p.y - r.y0],
    [dy, r.y1 - p.y],
  ];
  for (const [pk, qk] of clips) {
    if (pk === 0) {
      if (qk < 0) return false;
    } else {
      const t = qk / pk;
      if (pk < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}

function pointInTriangle(p: P2, a: P2, b: P2, c: P2): boolean {
  const s = (u: P2, v: P2, w: P2) => (u.x - w.x) * (v.y - w.y) - (v.x - w.x) * (u.y - w.y);
  const d1 = s(p, a, b);
  const d2 = s(p, b, c);
  const d3 = s(p, c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** Whether a screen triangle overlaps or touches the rectangle (any area in common). */
export function triangleHitsRect(a: P2, b: P2, c: P2, r: Rect): boolean {
  if (pointInRect(a, r) || pointInRect(b, r) || pointInRect(c, r)) return true;
  if (segmentHitsRect(a, b, r) || segmentHitsRect(b, c, r) || segmentHitsRect(c, a, r)) return true;
  // The rectangle may lie wholly inside the triangle.
  return pointInTriangle({ x: r.x0, y: r.y0 }, a, b, c);
}

/** Segments of an edge (pairs of points). Window: every end inside. Crossing: any segment touches. */
export function segmentsInBox(points: P2[], r: Rect, crossing: boolean): boolean {
  if (points.length === 0) return false;
  if (!crossing) return points.every((p) => pointInRect(p, r));
  for (let i = 0; i + 1 < points.length; i += 2) if (segmentHitsRect(points[i], points[i + 1], r)) return true;
  return points.length === 1 && pointInRect(points[0], r);
}

/** Triangles of a face (triples of points). Window: every corner inside. Crossing: any triangle overlaps. */
export function trianglesInBox(points: P2[], r: Rect, crossing: boolean): boolean {
  if (points.length === 0) return false;
  if (!crossing) return points.every((p) => pointInRect(p, r));
  for (let i = 0; i + 2 < points.length; i += 3) if (triangleHitsRect(points[i], points[i + 1], points[i + 2], r)) return true;
  return false;
}

/** A curve as a screen polyline. Window: every vertex inside. Crossing: any piece of it touches the rectangle. */
export function polylineInBox(points: P2[], r: Rect, crossing: boolean): boolean {
  if (points.length === 0) return false;
  if (!crossing) return points.every((p) => pointInRect(p, r));
  if (points.length === 1) return pointInRect(points[0], r);
  for (let i = 0; i + 1 < points.length; i++) if (segmentHitsRect(points[i], points[i + 1], r)) return true;
  return false;
}
