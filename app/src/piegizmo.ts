/** The maths of a pie-slice angle handle (HandleInfo.pie; the circular array's angle): a slice about an axis from the source's angle (0) round to the parameter's
 *  angle, on a ring of the real radius. The handle's anchor is the grip at the angle the handle was computed for (`value`), so the source is that point turned back. */
import * as THREE from "three";
import type { HandleInfo } from "./tools";

type PieInfo = Pick<HandleInfo, "ring" | "axis" | "anchor" | "value">;

/** How long the short lines toward the axis are, as a share of the ring's radius. */
export const PIE_TICK = 0.25;

function frame(info: PieInfo) {
  const [cx, cy, cz, radius] = info.ring!;
  const centre = new THREE.Vector3(cx, cy, cz);
  const axis = new THREE.Vector3(...info.axis!).normalize();
  const start = new THREE.Vector3(...info.anchor).sub(centre).applyAxisAngle(axis, (-info.value * Math.PI) / 180);
  return { centre, axis, start, radius };
}

/** The point of the ring `degrees` round from the source. */
export function piePoint(info: PieInfo, degrees: number): THREE.Vector3 {
  const { centre, axis, start } = frame(info);
  return centre.clone().add(start.clone().applyAxisAngle(axis, (degrees * Math.PI) / 180));
}

/** The direction of travel round the axis at `degrees` (unit). */
export function pieTangent(info: PieInfo, degrees: number): THREE.Vector3 {
  const { centre, axis } = frame(info);
  return axis.clone().cross(piePoint(info, degrees).sub(centre)).normalize();
}

/** The angle (degrees, the nearest turn to `previous`) at which a ray from the camera meets the slice's ring plane, or null when the ray runs along that plane. */
export function pieAngleAt(info: PieInfo, origin: THREE.Vector3, direction: THREE.Vector3, previous: number): number | null {
  const { centre, axis, start } = frame(info);
  const denom = axis.dot(direction);
  if (Math.abs(denom) < 1e-4) return null;
  const t = axis.dot(centre.clone().sub(origin)) / denom;
  const hit = origin.clone().addScaledVector(direction, t).sub(centre);
  const sin = axis.dot(start.clone().cross(hit));
  const cos = start.dot(hit);
  let degrees = (Math.atan2(sin, cos) * 180) / Math.PI;
  degrees += 360 * Math.round((previous - degrees) / 360);
  return degrees;
}

/** The lines of the slice at `degrees`: the arc from the source and the two short lines from the ring toward the axis (the source's and the last copy's). */
export function pieLines(info: PieInfo, degrees: number, steps = 48): { arc: THREE.Vector3[]; first: THREE.Vector3[]; last: THREE.Vector3[] } {
  const { centre } = frame(info);
  const tick = (p: THREE.Vector3) => [p.clone(), p.clone().lerp(centre, PIE_TICK)];
  const count = Math.max(2, Math.ceil((Math.abs(degrees) / 360) * steps));
  return {
    arc: Array.from({ length: count + 1 }, (_, i) => piePoint(info, (degrees * i) / count)),
    first: tick(piePoint(info, 0)),
    last: tick(piePoint(info, degrees)),
  };
}
