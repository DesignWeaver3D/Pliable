/** The direction to look at a curved face from: the mean of its triangle normals, or the axis of a face that wraps around. */
import * as THREE from "three";
import type { Viewport } from "./viewport.ts";

/** The part of the Viewport this file uses. */
export type FaceDirContext = Pick<Viewport, "camera" | "controls" | "mesh">;

/**
 * View direction for a non-planar face: the area-weighted mean of its triangle normals (cylinder, cone, sphere, freeform).
 * Faces that wrap around (full cylinder) average to nothing, so they use the direction from the model center to the face center.
 */
export function averageFaceDirection(view: FaceDirContext, range: { start: number; count: number }): THREE.Vector3 | null {
  if (!view.mesh) return null;
  const position = view.mesh.geometry.getAttribute("position");
  const index = view.mesh.geometry.getIndex()!.array;
  const sum = new THREE.Vector3();
  const centre = new THREE.Vector3();
  const [a, b, c, n] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  let area = 0;
  for (let i = range.start; i < range.start + range.count; i += 3) {
    a.fromBufferAttribute(position, index[i]);
    b.fromBufferAttribute(position, index[i + 1]);
    c.fromBufferAttribute(position, index[i + 2]);
    n.crossVectors(b.clone().sub(a), c.clone().sub(a)).multiplyScalar(0.5); // length = triangle area
    sum.add(n);
    area += n.length();
    centre.addScaledVector(a.clone().add(b).add(c), n.length() / 3);
  }
  if (area === 0) return null;
  if (sum.length() > area * 0.1) return sum; // normalized by the caller
  const axis = wrapAxis(view, range);
  if (axis) {
    // Look along the axis from the side the camera is already on.
    const toCamera = view.camera.position.clone().sub(view.controls.target);
    return toCamera.dot(axis) < 0 ? axis.negate() : axis;
  }
  centre.divideScalar(area);
  view.mesh.geometry.computeBoundingBox();
  const outward = centre.sub(view.mesh.geometry.boundingBox!.getCenter(new THREE.Vector3()));
  return outward.length() > 1e-9 ? outward : null;
}

/**
 * Axis of a cylinder- or cone-like face: the direction every triangle normal is perpendicular to. The area-weighted
 * covariance of the normals has rank 2 there, so its null vector is the cross product of two of its rows.
 * Returns null when the normals span all three directions (sphere, torus, freeform).
 */
export function wrapAxis(view: FaceDirContext, range: { start: number; count: number }): THREE.Vector3 | null {
  const position = view.mesh!.geometry.getAttribute("position");
  const index = view.mesh!.geometry.getIndex()!.array;
  const [a, b, c, n] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const m = new THREE.Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0);
  let area = 0;
  for (let i = range.start; i < range.start + range.count; i += 3) {
    a.fromBufferAttribute(position, index[i]);
    b.fromBufferAttribute(position, index[i + 1]);
    c.fromBufferAttribute(position, index[i + 2]);
    n.crossVectors(b.clone().sub(a), c.clone().sub(a));
    const w = n.length() / 2;
    if (w === 0) continue;
    n.normalize();
    const v = [n.x, n.y, n.z];
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) m.elements[k * 3 + r] += w * v[r] * v[k];
    area += w;
  }
  if (area === 0) return null;
  const rows = [0, 1, 2].map((r) => new THREE.Vector3(m.elements[r], m.elements[3 + r], m.elements[6 + r]).divideScalar(area));
  let best: THREE.Vector3 | null = null;
  for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) {
    const axis = rows[i].clone().cross(rows[j]);
    if (!best || axis.length() > best.length()) best = axis;
  }
  if (!best || best.length() < 1e-6) return null;
  best.normalize();
  // The axis is only valid if the normals really are perpendicular to it (mean squared cosine near zero).
  const perp = rows.reduce((s, row) => s + Math.abs(row.dot(best!)), 0);
  return perp < 0.05 ? best : null;
}
