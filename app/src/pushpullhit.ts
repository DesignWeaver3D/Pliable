/** Grabbing the red mirrored arrow of push/pull: it lies from the arrow's anchor the opposite way, as long as the arrow itself, and pressing it is pressing the arrow. */
export interface Pt {
  x: number;
  y: number;
}

import { projectOnSegment } from "./segmentmath.ts";

/** Pixel distance from a point to the segment a-b (the nearest point on it, ends included). */
export function segmentPx(p: Pt, a: Pt, b: Pt): number {
  return projectOnSegment(p.x, p.y, a.x, a.y, b.x, b.y, 1e-6).dist;
}

/** The 3D end of the red arrow's arm: the anchor moved against the arrow's direction by `reach` (model units). */
export function mirrorEnd(anchor: readonly number[], direction: readonly number[], reach: number): [number, number, number] {
  return [anchor[0] - direction[0] * reach, anchor[1] - direction[1] * reach, anchor[2] - direction[2] * reach];
}
