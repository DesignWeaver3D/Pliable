import * as THREE from "three";
import type { MeshData } from "./client";
import { bodyColor } from "./bodycolors";

/** Neutral surface colour used by loose faces and sheets, which belong to no body. */
const NEUTRAL = new THREE.Color(0x9db4cc);

/** Per-vertex colours for a mesh: each face's vertices take their body's colour; faces without a body stay neutral. */
export function bodyColorArray(mesh: MeshData): Float32Array {
  const out = new Float32Array(mesh.positions.length);
  for (let i = 0; i < out.length; i += 3) NEUTRAL.toArray(out, i);
  const c = new THREE.Color();
  const cache = new Map<number, THREE.Color>();
  for (const f of mesh.faces) {
    if (f.body == null) continue;
    let col = cache.get(f.body);
    if (!col) {
      col = c.set(bodyColor(f.body)).clone();
      cache.set(f.body, col);
    }
    for (let k = f.start; k < f.start + f.count; k++) col.toArray(out, mesh.indices[k] * 3);
  }
  return out;
}
