/** The arithmetic behind picking a base point and a destination point (kept free of the DOM for tests). */

export type Vec3 = readonly [number, number, number];

/** The move vector that takes `base` to `destination`. */
export function moveVector(base: Vec3, destination: Vec3): [number, number, number] {
  return [destination[0] - base[0], destination[1] - base[1], destination[2] - base[2]];
}

/** The placement point (origin) that puts the anchor at `destination`, given the anchor's offset from the origin. */
export function originFor(destination: Vec3, offset: Vec3): [number, number, number] {
  return [destination[0] - offset[0], destination[1] - offset[1], destination[2] - offset[2]];
}

/** A point for a label: at most three decimals. */
export function pointText(p: Vec3): string {
  return p.map((c) => String(Math.round(c * 1000) / 1000)).join(", ");
}

export interface AnchorInfo {
  label: string;
  offset: [number, number, number];
}
