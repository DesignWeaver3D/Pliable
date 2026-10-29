/** Grabbing the red mirrored arrow of push/pull: it lies from the arrow's anchor the opposite way, as long as the arrow itself, and pressing it is pressing the arrow. */
export interface Pt {
  x: number;
  y: number;
}

/** Pixel distance from a point to the segment a-b (the nearest point on it, ends included). */
export function segmentPx(p: Pt, a: Pt, b: Pt): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  const t = len2 < 1e-6 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

/** The 3D end of the red arrow's arm: the anchor moved against the arrow's direction by `reach` (model units). */
export function mirrorEnd(anchor: readonly number[], direction: readonly number[], reach: number): [number, number, number] {
  return [anchor[0] - direction[0] * reach, anchor[1] - direction[1] * reach, anchor[2] - direction[2] * reach];
}
