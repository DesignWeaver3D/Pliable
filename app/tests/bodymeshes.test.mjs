import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { BodyMeshes, partColors } from "../src/bodymeshes.ts";

const part = (body, ref = {}) => ({ body, ref, positions: new Float32Array(9), normals: new Float32Array(9), indices: new Uint32Array([0, 1, 2]), edgePositions: new Float32Array(6) });
const materials = () => ({ surface: new THREE.MeshBasicMaterial(), ghost: new THREE.MeshBasicMaterial(), edge: new THREE.LineBasicMaterial(), back: { material: new THREE.MeshBasicMaterial(), ghostMaterial: new THREE.MeshBasicMaterial() } });

test("a body whose part is the same keeps its graphics; a changed or new one gets new ones", () => {
  const group = new THREE.Group();
  const m = new BodyMeshes(group);
  const mats = materials();
  const a = part(1);
  const b = part(2);
  m.update([a, b], mats, new Set(), new Set());
  assert.equal(group.children.length, 4); // surface + edges per body
  const before = m.solidMeshes(new Set());
  const b2 = part(2);
  m.update([a, b2, part(3)], mats, new Set(), new Set());
  const after = m.solidMeshes(new Set());
  assert.equal(after[0], before[0]); // unchanged: the same mesh, not uploaded again
  assert.notEqual(after[1], before[1]);
  assert.equal(after.length, 3);
  assert.deepEqual(m.built, [2, 3]);
  assert.equal(group.children.length, 6); // the replaced body's old objects are gone
});

test("a part that is no longer listed loses its graphics", () => {
  const group = new THREE.Group();
  const m = new BodyMeshes(group);
  const a = part(1);
  m.update([a, part(2)], materials(), new Set(), new Set());
  m.update([a], materials(), new Set(), new Set());
  assert.equal(group.children.length, 2);
});

test("surface bodies get a back mesh that shares the body's geometry; see-through bodies use the see-through materials", () => {
  const group = new THREE.Group();
  const m = new BodyMeshes(group);
  const mats = materials();
  m.update([part(1), part(2)], mats, new Set([2]), new Set());
  const backs = group.children.filter((c) => c.material === mats.back.material);
  assert.equal(backs.length, 1);
  const front = m.solidMeshes(new Set())[1];
  assert.equal(backs[0].geometry, front.geometry);
  m.setGhosted(new Set([2]));
  assert.equal(front.material, mats.ghost);
  assert.equal(backs[0].material, mats.back.ghostMaterial);
  assert.deepEqual(m.solidMeshes(new Set([2])).length, 1);
  m.setGhosted(new Set());
  assert.equal(front.material, mats.surface);
});

test("every body's vertices take that body's color, loose faces the neutral one", () => {
  const colored = partColors({ body: 5, positions: new Float32Array(6) });
  assert.equal(colored.length, 6);
  assert.deepEqual([...colored.slice(0, 3)], [...colored.slice(3)]);
  assert.notDeepEqual([...partColors({ body: 6, positions: new Float32Array(3) })], [...colored.slice(0, 3)]);
  const neutral = partColors({ body: null, positions: new Float32Array(3) });
  assert.ok(Math.abs(neutral[0] - new THREE.Color(0x9db4cc).r) < 1e-6);
});

test("an update puts slid bodies back and parts without geometry are skipped", () => {
  const group = new THREE.Group();
  const m = new BodyMeshes(group);
  const a = part(1);
  m.update([a, { ...part(2), positions: new Float32Array(0), edgePositions: new Float32Array(0) }], materials(), new Set(), new Set());
  assert.equal(m.size, 1);
  m.slide(new Set([1]), [3, 0, 0]);
  assert.equal(m.solidMeshes(new Set())[0].position.x, 3);
  m.update([a], materials(), new Set(), new Set());
  assert.equal(m.solidMeshes(new Set())[0].position.x, 0);
});
