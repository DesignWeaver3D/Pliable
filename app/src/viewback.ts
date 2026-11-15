/** The back side of surface bodies (open shells): drawn as a second mesh, seen from behind, in the body's own color made darker.
 * Solids are not part of it: they keep front-side drawing only. */
import * as THREE from "three";
import type { MeshData } from "./client.ts";
import { ghostRuns } from "./visibility.ts";

/** The back side shows the body's color times this (40% darker). */
export const BACK_TINT = 0.6;

/** The second mesh of a model that has surface bodies: its own index (the surface faces only), the same vertex data. */
export interface BackSide {
  mesh: THREE.Mesh;
  material: THREE.MeshPhysicalMaterial;
  ghostMaterial: THREE.MeshPhysicalMaterial;
  /** Ids of the surface bodies drawn here. */
  ids: Set<number>;
  /** For each triangle of the back index, the triangle it is in the main index (picking and see-through use the main one). */
  toMain: Uint32Array;
  /** The surface faces in back-index units, for the see-through runs. */
  faces: { start: number; count: number; body: number }[];
}

/** Ids of the surface bodies in a mesh reply (the core marks them in the body rows). */
export function surfaceBodyIds(mesh: Pick<MeshData, "header">): Set<number> {
  const rows: { id: number; surface?: boolean }[] = mesh.header?.bodies ?? [];
  return new Set(rows.filter((b) => b.surface).map((b) => b.id));
}

/** The index and triangle map of the back side: the triangles of every face of the given bodies, in draw order. */
export function backIndex(mesh: Pick<MeshData, "faces" | "indices">, ids: ReadonlySet<number>) {
  const pick = mesh.faces.filter((f) => f.body != null && ids.has(f.body) && f.count > 0);
  const total = pick.reduce((n, f) => n + f.count, 0);
  const indices = new Uint32Array(total);
  const toMain = new Uint32Array(total / 3);
  const faces: BackSide["faces"] = [];
  let at = 0;
  for (const f of pick) {
    indices.set(mesh.indices.subarray(f.start, f.start + f.count), at);
    for (let t = 0; t < f.count / 3; t++) toMain[at / 3 + t] = f.start / 3 + t;
    faces.push({ start: at, count: f.count, body: f.body as number });
    at += f.count;
  }
  return { indices, toMain, faces };
}

/** Build the back side for a new mesh, or null when the model has no surface body. */
export function buildBack(parent: THREE.Object3D, main: THREE.Mesh, data: MeshData): BackSide | null {
  const ids = surfaceBodyIds(data);
  if (ids.size === 0) return null;
  const { indices, toMain, faces } = backIndex(data, ids);
  if (indices.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  for (const name of ["position", "normal"]) geometry.setAttribute(name, main.geometry.getAttribute(name));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  const material = new THREE.MeshPhysicalMaterial();
  const ghostMaterial = new THREE.MeshPhysicalMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.visible = false; // only for picking: the back sides are drawn per body (bodymeshes.ts)
  parent.add(mesh);
  return { mesh, material, ghostMaterial, ids, toMain, faces };
}

function follow(back: THREE.MeshPhysicalMaterial, front: THREE.MeshPhysicalMaterial) {
  back.copy(front);
  back.side = THREE.BackSide;
  back.color.multiplyScalar(BACK_TINT); // the vertex colors multiply the base color, so this darkens whatever color the body has
  back.clippingPlanes = front.clippingPlanes;
  back.needsUpdate = true;
}

/** Make the back side follow the front material (look, color, see-through, section clip) and the see-through bodies. */
export function syncBack(
  main: THREE.Mesh | null,
  surface: THREE.MeshPhysicalMaterial,
  ghost: THREE.MeshPhysicalMaterial | null,
  ghosted: ReadonlySet<number>,
) {
  const back: BackSide | undefined = main?.userData.back;
  if (!back) return;
  follow(back.material, surface);
  if (ghost) follow(back.ghostMaterial, ghost);
  back.mesh.geometry.clearGroups();
  if (ghosted.size === 0 || !ghost) {
    back.mesh.material = back.material;
    return;
  }
  back.mesh.material = [back.material, back.ghostMaterial];
  for (const run of ghostRuns(back.faces, ghosted, back.mesh.geometry.getIndex()!.count)) back.mesh.geometry.addGroup(run.start, run.count, run.ghost ? 1 : 0);
}

/** Hits of a ray on the back side of surface bodies, as hits in the main mesh (faceIndex of the main index). */
export function backHits(main: THREE.Mesh, raycaster: THREE.Raycaster): THREE.Intersection[] {
  const back: BackSide | undefined = main.userData.back;
  if (!back) return [];
  return raycaster.intersectObject(back.mesh).map((h) => ({ ...h, faceIndex: h.faceIndex == null ? h.faceIndex : back.toMain[h.faceIndex] }));
}

/** Hits of a ray on the model: the front side of everything and the back side of surface bodies, nearest first. */
export function modelHits(main: THREE.Mesh, raycaster: THREE.Raycaster): THREE.Intersection[] {
  const hits = raycaster.intersectObject(main);
  if (!main.userData.back) return hits;
  return [...hits, ...backHits(main, raycaster)].sort((a, b) => a.distance - b.distance);
}
