/** Makes ray tests against the model's mesh use a triangle tree: hover and picking then cost the same on a large model as on a small one. */
import * as THREE from "three";
import { buildTriangleTree, type Facing, type TriangleTree } from "./trianglebvh.ts";

const FACING: Record<number, Facing> = { [THREE.FrontSide]: "front", [THREE.BackSide]: "back", [THREE.DoubleSide]: "both" };

/** The one side setting of the mesh's material or materials, or null when they differ (the plain test handles that). */
function sideOf(mesh: THREE.Mesh): Facing | null {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  if (!materials.length || materials.some((m) => !m || m.side !== materials[0].side)) return null;
  if (Array.isArray(mesh.material)) {
    // With several materials only the triangles inside a group are tested: the tree holds them all, so the groups must cover the mesh.
    const covered = mesh.geometry.groups.reduce((n, g) => n + g.count, 0);
    if (covered !== (mesh.geometry.index?.count ?? -1)) return null;
  }
  return FACING[materials[0].side] ?? null;
}

/**
 * Replace the mesh's ray test. three.js tests every triangle (3 ms a pointer move at 40,000 triangles, growing with the
 * model); the tree finds the same hits in microseconds. The tree is built on the second test of the same buffers, so a
 * mesh that is shown for one drag step and replaced never pays for one. Anything the tree does not cover (no index, a
 * draw range, materials with different sides) goes to three.js's own test.
 */
export function installTreeRaycast(mesh: THREE.Mesh) {
  const plain = mesh.raycast.bind(mesh);
  let tree: TriangleTree | null = null;
  let seen: { index: ArrayLike<number>; positions: ArrayLike<number> } | null = null;
  const inverse = new THREE.Matrix4();
  const ray = new THREE.Ray();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();

  mesh.raycast = (raycaster: THREE.Raycaster, intersects: THREE.Intersection[]) => {
    const geometry = mesh.geometry;
    const index = geometry.index;
    const position = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    const facing = sideOf(mesh);
    const range = geometry.drawRange;
    if (!index || !position || facing === null || position.itemSize !== 3 || (position as unknown as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute || range.start !== 0 || range.count !== Infinity) {
      return plain(raycaster, intersects);
    }
    if (!seen || seen.index !== index.array || seen.positions !== position.array) {
      seen = { index: index.array, positions: position.array };
      tree = null;
      return plain(raycaster, intersects); // first test of these buffers: not worth a tree yet
    }
    tree ??= buildTriangleTree(position.array, index.array);
    inverse.copy(mesh.matrixWorld).invert();
    ray.copy(raycaster.ray).applyMatrix4(inverse);
    const positions = position.array;
    const corners = index.array;
    const found: [number, number][] = [];
    tree.raycast(ray.origin.x, ray.origin.y, ray.origin.z, ray.direction.x, ray.direction.y, ray.direction.z, facing, (triangle, t) => found.push([triangle, t]));
    found.sort((x, y) => x[0] - y[0]); // in triangle order, as the plain test reports them: hits at the same distance then keep their order
    for (const [triangle, t] of found) {
      const point = ray.at(t, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
      const distance = raycaster.ray.origin.distanceTo(point);
      if (distance < raycaster.near || distance > raycaster.far) continue;
      const ia = corners[triangle * 3];
      const ib = corners[triangle * 3 + 1];
      const ic = corners[triangle * 3 + 2];
      a.fromArray(positions, ia * 3);
      b.fromArray(positions, ib * 3);
      c.fromArray(positions, ic * 3);
      const normal = THREE.Triangle.getNormal(a, b, c, new THREE.Vector3());
      intersects.push({ distance, point, object: mesh, faceIndex: triangle, face: { a: ia, b: ib, c: ic, normal, materialIndex: 0 } });
    }
  };
}
