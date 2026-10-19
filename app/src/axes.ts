/** Principal axes of the model: shared colours and the rule for how long the origin axes are drawn. */

/** Colour of each principal axis; the origin axes and the navigation cube's origin edges both use these. */
export const AXIS_COLORS = { x: 0xe5484d, y: 0x46a758, z: 0x3e8bff } as const;

export const MIN_HALF_LENGTH = 25;
/** How far past the content the axes extend, as a multiple of its size. */
export const AXIS_MARGIN = 1.25;

/** A box as [xmin, ymin, zmin, xmax, ymax, zmax]. */
export type Box6 = readonly number[];

/** Half-length of the origin axes for the visible content: past the largest extent of all boxes (taken together with the origin). */
export function axisHalfLength(boxes: readonly Box6[]): number {
  const lo = [0, 0, 0];
  const hi = [0, 0, 0];
  for (const b of boxes) {
    if (b.length < 6 || b.some((v) => !Number.isFinite(v))) continue;
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], b[i]);
      hi[i] = Math.max(hi[i], b[i + 3]);
    }
  }
  let size = 0;
  for (let i = 0; i < 3; i++) size = Math.max(size, hi[i] - lo[i], Math.abs(lo[i]), Math.abs(hi[i]));
  return Math.max(MIN_HALF_LENGTH, AXIS_MARGIN * size);
}

/** Bounding box of a flat xyz position array, or null if empty. */
export function positionsBox(p: ArrayLike<number>): Box6 | null {
  if (p.length < 3) return null;
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      b[k] = Math.min(b[k], p[i + k]);
      b[k + 3] = Math.max(b[k + 3], p[i + k]);
    }
  }
  return b;
}
