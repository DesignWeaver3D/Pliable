import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { BodyMeshes } from "../src/bodymeshes.ts";
import { slideBodies, unsplit } from "../src/viewslide.ts";

const part = (body) => ({ body, ref: {}, positions: new Float32Array(9), normals: new Float32Array(9), indices: new Uint32Array([0, 1, 2]), edgePositions: new Float32Array(6) });

function viewport() {
  const bodyMeshes = new BodyMeshes(new THREE.Group());
  bodyMeshes.update([part(1), part(2)], { surface: new THREE.MeshBasicMaterial(), ghost: null, edge: new THREE.LineBasicMaterial(), back: null }, new Set(), new Set());
  const data = {
    faces: [{ start: 0, count: 3, body: 1 }, { start: 3, count: 3, body: 2 }],
    edges: [{ start: 0, count: 2, body: 1 }, { start: 2, count: 2, body: 2 }],
  };
  return { data, bodyMeshes, moving: null };
}
const xs = (v) => v.bodyMeshes.solidMeshes(new Set()).map((m) => m.position.x);

test("sliding shifts only the meshes of the bodies", () => {
  const v = viewport();
  slideBodies(v, new Set([1]), [1, 2, 3]);
  assert.deepEqual(xs(v), [1, 0]);
  assert.deepEqual(v.moving.bodies, new Set([1]));
});

test("a second slide of the same bodies only repositions", () => {
  const v = viewport();
  slideBodies(v, new Set([1]), [1, 0, 0]);
  const first = v.moving;
  slideBodies(v, new Set([1]), [4, 0, 0]);
  assert.equal(v.moving, first);
  assert.deepEqual(xs(v), [4, 0]);
});

test("sliding other bodies puts the first back, and unsplit puts all back", () => {
  const v = viewport();
  slideBodies(v, new Set([1]), [1, 0, 0]);
  slideBodies(v, new Set([2]), [0, 1, 0]);
  assert.deepEqual(xs(v), [0, 0]);
  assert.equal(v.bodyMeshes.solidMeshes(new Set())[1].position.y, 1);
  unsplit(v);
  assert.equal(v.moving, null);
  assert.deepEqual(v.bodyMeshes.solidMeshes(new Set()).map((m) => m.position.y), [0, 0]);
});

test("bodies with nothing in the mesh change nothing", () => {
  const v = viewport();
  slideBodies(v, new Set([99]), [1, 0, 0]);
  assert.equal(v.moving, null);
  assert.deepEqual(xs(v), [0, 0]);
});
