import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { BACK_TINT, backIndex, surfaceBodyIds, syncBack } from "../src/viewback.ts";

const mesh = {
  header: { bodies: [{ id: 1, surface: false }, { id: 2, surface: true }] },
  indices: new Uint32Array([0, 1, 2, 2, 3, 0, 4, 5, 6, 7, 8, 9]),
  faces: [
    { id: 10, start: 0, count: 6, body: 1 },
    { id: 11, start: 6, count: 3, body: 2 },
    { id: 12, start: 9, count: 3, body: 2 },
  ],
};

test("only surface bodies get a back side", () => {
  assert.deepEqual([...surfaceBodyIds(mesh)], [2]);
  const back = backIndex(mesh, surfaceBodyIds(mesh));
  assert.deepEqual([...back.indices], [4, 5, 6, 7, 8, 9]);
  assert.deepEqual([...back.toMain], [2, 3]); // the triangles of the main index
  assert.deepEqual(back.faces, [{ start: 0, count: 3, body: 2 }, { start: 3, count: 3, body: 2 }]);
});

test("the back material is the front color 40 percent darker and follows the front", () => {
  assert.equal(BACK_TINT, 0.6);
  const main = new THREE.Mesh();
  const front = new THREE.MeshPhysicalMaterial({ color: 0xffffff });
  const back = new THREE.MeshPhysicalMaterial();
  main.userData.back = { mesh: new THREE.Mesh(new THREE.BufferGeometry().setIndex([0, 1, 2]), back), material: back, ghostMaterial: new THREE.MeshPhysicalMaterial(), ids: new Set([2]), faces: [] };
  syncBack(main, front, null, new Set(), null);
  assert.ok(Math.abs(back.color.r - 0.6) < 1e-6 && back.side === THREE.BackSide);
  front.color.set(0x808080);
  syncBack(main, front, null, new Set(), null);
  assert.ok(Math.abs(back.color.r - front.color.r * 0.6) < 1e-6);
  syncBack(main, front, null, new Set(), { bodies: new Set([2]) });
  assert.equal(main.userData.back.mesh.visible, false);
});
