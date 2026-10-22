/** Where a datum plane is drawn: a square about its origin, in its own plane. */
import * as THREE from "three";

export interface DatumPlane {
  id: number;
  name: string;
  plane: { origin: [number, number, number]; normal: [number, number, number]; xdir: [number, number, number] };
}

/** Mirror modeling mode while it is on: the plane changes are repeated across. */
export interface MirrorMode {
  name: string;
  plane: DatumPlane["plane"];
}

/** Half the side of a drawn datum plane, in model units. */
export const DATUM_HALF = 60;

/** The corners of a datum plane's drawn square, in order round it. */
export function datumCorners(p: DatumPlane["plane"], half = DATUM_HALF): number[][] {
  const n = new THREE.Vector3(...p.normal).normalize();
  const u = new THREE.Vector3(...p.xdir).normalize();
  const v = new THREE.Vector3().crossVectors(n, u);
  const o = new THREE.Vector3(...p.origin);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => o.clone().addScaledVector(u, a * half).addScaledVector(v, b * half).toArray());
}

