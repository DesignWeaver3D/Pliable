/** The arithmetic behind picking a base point and a destination point (kept free of the DOM for tests). */
import { showNumber } from "./precision.ts";

export type Vec3 = readonly [number, number, number];

/** The move vector that takes `base` to `destination`. */
export function moveVector(base: Vec3, destination: Vec3): [number, number, number] {
  return [destination[0] - base[0], destination[1] - base[1], destination[2] - base[2]];
}

/** The placement point (origin) that puts the anchor at `destination`, given the anchor's offset from the origin. */
export function originFor(destination: Vec3, offset: Vec3): [number, number, number] {
  return [destination[0] - offset[0], destination[1] - offset[1], destination[2] - offset[2]];
}

/** Where a picked base point sits relative to the placement point (the offset `originFor` takes). */
export function offsetOf(base: Vec3, origin: Vec3): [number, number, number] {
  return [base[0] - origin[0], base[1] - origin[1], base[2] - origin[2]];
}

/** A point for a label: at most the global number of decimals. */
export function pointText(p: Vec3): string {
  return p.map((c) => showNumber(c)).join(", ");
}

export interface AnchorInfo {
  label: string;
  offset: [number, number, number];
}

/** The handles with every move arrow relocated to `point` (the picked base point), so the arrows grab the thing being moved. */
export function moveHandlesAt<T extends { kind?: string; anchor: [number, number, number] }>(handles: T[], point: Vec3 | null): T[] {
  if (!point) return handles;
  return handles.map((h) => (h.kind === "move" ? { ...h, anchor: [point[0], point[1], point[2]] as [number, number, number] } : h));
}

/** The hole and circle centers a point pick may snap to: every center of the model (not only those of the hovered hole, which the pick never hovers) that passes the visibility test. */
export function snapCentres(all: { position: number[] }[], visible: (p: Vec3) => boolean): Vec3[] {
  return all.map((c) => [c.position[0], c.position[1], c.position[2]] as Vec3).filter(visible);
}

/** Where a hole's axis meets the plane (point, normal): the hole center on the face around its mouth, or null if the axis lies parallel to it. */
export function axisOnPlane(centre: Vec3, axis: Vec3, planePoint: Vec3, normal: Vec3): Vec3 | null {
  const along = normal[0] * axis[0] + normal[1] * axis[1] + normal[2] * axis[2];
  if (Math.abs(along) < 1e-9) return null;
  const t = (normal[0] * (planePoint[0] - centre[0]) + normal[1] * (planePoint[1] - centre[1]) + normal[2] * (planePoint[2] - centre[2])) / along;
  return [centre[0] + axis[0] * t, centre[1] + axis[1] * t, centre[2] + axis[2] * t];
}

/** The hole center on each side of the hole: where its axis meets the nearest plane square to it on either side of the center (the faces around the two mouths). */
export function mouthPoints(centre: Vec3, axis: Vec3, planes: { point: Vec3; normal: Vec3 }[]): Vec3[] {
  let before: { t: number; p: Vec3 } | null = null;
  let after: { t: number; p: Vec3 } | null = null;
  for (const pl of planes) {
    const along = pl.normal[0] * axis[0] + pl.normal[1] * axis[1] + pl.normal[2] * axis[2];
    if (Math.abs(along) < 0.999) continue; // only planes square to the axis
    const p = axisOnPlane(centre, axis, pl.point, pl.normal);
    if (!p) continue;
    const t = (p[0] - centre[0]) * axis[0] + (p[1] - centre[1]) * axis[1] + (p[2] - centre[2]) * axis[2];
    if (t > 1e-6 && (!after || t < after.t)) after = { t, p };
    if (t < -1e-6 && (!before || t > before.t)) before = { t, p };
  }
  return [before?.p, after?.p].filter((p): p is Vec3 => !!p);
}
