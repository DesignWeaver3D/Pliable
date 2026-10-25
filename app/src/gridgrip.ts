/** The cube grip of a grid (the linear array's corner): dragged in the plane of the two step vectors, it sets the two counts
 *  independently. The pointer's point on that plane, measured from where it was pressed, is split into whole column steps
 *  along u and whole row steps along v. */
type V3 = readonly [number, number, number];

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** The point where a ray meets the plane through `anchor` spanned by u and v, or null when the ray runs along the plane or the steps are parallel. */
export function planePoint(origin: V3, dir: V3, anchor: V3, u: V3, v: V3): V3 | null {
  const n = cross(u, v);
  const len = Math.sqrt(dot(n, n));
  if (len < 1e-9) return null;
  const unit: V3 = [n[0] / len, n[1] / len, n[2] / len];
  const denom = dot(dir, unit);
  if (Math.abs(denom) < 1e-6) return null;
  const t = dot([anchor[0] - origin[0], anchor[1] - origin[1], anchor[2] - origin[2]], unit) / denom;
  return [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
}

/** The counts after the pointer moved by `delta` in the plane: whole steps along u (columns) and v (rows), each at least `min`. */
export function gridCounts(delta: V3, u: V3, v: V3, columns: number, rows: number, min = 1): { columns: number; rows: number } {
  const uu = dot(u, u);
  const vv = dot(v, v);
  const uv = dot(u, v);
  const det = uu * vv - uv * uv;
  if (det < 1e-12) return { columns, rows };
  const du = dot(delta, u);
  const dv = dot(delta, v);
  const a = (du * vv - dv * uv) / det;
  const b = (dv * uu - du * uv) / det;
  return { columns: Math.max(min, Math.round(columns + a)), rows: Math.max(min, Math.round(rows + b)) };
}

/** Where the grip sits for those counts: its first position moved by the whole steps added or removed. */
export function gridShift(u: V3, v: V3, columns: number, rows: number, columns0: number, rows0: number): V3 {
  const a = columns - columns0;
  const b = rows - rows0;
  return [u[0] * a + v[0] * b, u[1] * a + v[1] * b, u[2] * a + v[2] * b];
}
