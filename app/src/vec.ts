/** Small vector helpers shared across the app: 3D (model space) and 2D (sketch plane) tuples, no DOM and no three.js.
 *  The unit helpers differ only in what a zero vector gives: `unit3` / `unit2` return it unchanged (as zeros), `unit3OrNull` returns null
 *  and `unit2OrZero` returns [0, 0] for anything shorter than 1e-9. */
export type Vec3 = [number, number, number];
export type Pt = [number, number];

export const sub3 = (a: readonly number[], b: readonly number[]): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot3 = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a: readonly number[], b: readonly number[]): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** The unit vector; a zero vector stays zero (the length is taken as 1). */
export const unit3 = (a: readonly number[]): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** The unit vector, or null when the length is under 1e-9. */
export function unit3OrNull(v: readonly number[]): Vec3 | null {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length < 1e-9 ? null : [v[0] / length, v[1] / length, v[2] / length];
}

/** The unit vector; a zero vector stays zero (the length is taken as 1). */
export const unit2 = (a: Pt): Pt => {
  const l = Math.hypot(a[0], a[1]) || 1;
  return [a[0] / l, a[1] / l];
};

/** The unit vector, or [0, 0] when the length is under 1e-9. */
export const unit2OrZero = (a: Pt): Pt => {
  const n = Math.hypot(a[0], a[1]);
  return n < 1e-9 ? [0, 0] : [a[0] / n, a[1] / n];
};
