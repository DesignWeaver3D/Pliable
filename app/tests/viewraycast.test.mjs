import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { partsCover } from "../src/bodyparts.ts";
import { installTreeRaycast } from "../src/viewraycast.ts";

// Two square bodies one above the other (z 0 and z 1), two triangles each, facing +z.
const square = (z, x = 0) => ({ positions: Float32Array.from([x, 0, z, x + 1, 0, z, x + 1, 1, z, x, 1, z]), indices: Uint32Array.from([0, 1, 2, 0, 2, 3]) });
const part = (body, s) => ({ body, ref: {}, positions: s.positions, normals: new Float32Array(12), indices: s.indices, edgePositions: new Float32Array(0) });

function merged(squares) {
  const positions = new Float32Array(squares.reduce((n, s) => n + s.positions.length, 0));
  const indices = new Uint32Array(squares.reduce((n, s) => n + s.indices.length, 0));
  let p = 0, i = 0;
  for (const s of squares) {
    for (let k = 0; k < s.indices.length; k++) indices[i + k] = s.indices[k] + p / 3;
    positions.set(s.positions, p);
    p += s.positions.length;
    i += s.indices.length;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
}

function hits(mesh, x, y) {
  const raycaster = new THREE.Raycaster(new THREE.Vector3(x, y, 5), new THREE.Vector3(0, 0, -1));
  const out = [];
  mesh.raycast(raycaster, out);
  return out.map((h) => [h.faceIndex, Math.round(h.distance * 1e6) / 1e6]);
}

test("per-body trees report the same hits as three.js, with the mesh's triangle numbers", () => {
  const squares = [square(0), square(1), square(0, 3)];
  const parts = squares.map((s, n) => part(n + 1, s));
  const mesh = merged(squares);
  mesh.updateMatrixWorld();
  const plain = merged(squares);
  plain.updateMatrixWorld();
  assert.ok(partsCover(parts, mesh.geometry.index.count));
  installTreeRaycast(mesh, parts);
  const expected = hits(plain, 0.75, 0.5).sort((a, b) => a[0] - b[0]);
  assert.equal(expected.length, 2);
  assert.deepEqual(hits(mesh, 0.75, 0.5), expected); // the first test already uses the trees
  assert.deepEqual(hits(mesh, 3.75, 0.5), hits(plain, 3.75, 0.5)); // the third body: triangles 4 and 5
  assert.deepEqual(hits(mesh, 9, 9), []);
});

test("a tree is kept for a body whose part is the same on the next mesh", () => {
  const squares = [square(0), square(1)];
  const parts = squares.map((s, n) => part(n + 1, s));
  for (const run of [0, 1]) {
    const mesh = merged(squares);
    mesh.updateMatrixWorld();
    installTreeRaycast(mesh, parts);
    assert.equal(hits(mesh, 0.75, 0.5).length, 2, `run ${run}`);
  }
});

test("parts that do not cover the mesh are not used", () => {
  assert.equal(partsCover(undefined, 6), false);
  assert.equal(partsCover([part(1, square(0))], 12), false);
});
