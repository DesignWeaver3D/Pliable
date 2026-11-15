import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { slideBodies, unsplit } from "../src/viewslide.ts";

function viewport() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(18), 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(18), 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(18), 3));
  const data = {
    indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
    edgePositions: new Float32Array([0, 0, 0, 1, 0, 0, 5, 0, 0, 6, 0, 0]),
    faces: [{ start: 0, count: 3, body: 1 }, { start: 3, count: 3, body: 2 }],
    edges: [{ start: 0, count: 2, body: 1 }, { start: 2, count: 2, body: 2 }],
  };
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  const surfaceMaterial = new THREE.MeshBasicMaterial();
  const edgeMaterial = new THREE.LineBasicMaterial();
  const edgeLines = new THREE.LineSegments(new THREE.BufferGeometry(), edgeMaterial);
  edgeLines.geometry.setAttribute("position", new THREE.BufferAttribute(data.edgePositions, 3));
  return { data, mesh: new THREE.Mesh(geometry, surfaceMaterial), edgeLines, edgeMaterial, surfaceMaterial, ghostMaterial: null, ghosted: new Set(), model: new THREE.Group(), moving: null };
}

test("sliding splits the body from the draw lists and offsets it", () => {
  const v = viewport();
  slideBodies(v, new Set([1]), [1, 2, 3]);
  assert.deepEqual([...v.mesh.geometry.getIndex().array], [3, 4, 5]);
  assert.deepEqual([...v.moving.surface.geometry.getIndex().array], [0, 1, 2]);
  assert.deepEqual(v.moving.surface.position.toArray(), [1, 2, 3]);
  assert.deepEqual(v.moving.edges.position.toArray(), [1, 2, 3]);
  assert.equal(v.model.children.length, 2);
  assert.equal(v.edgeLines.geometry.getAttribute("position").count, 2);
});

test("a second slide of the same bodies only repositions", () => {
  const v = viewport();
  slideBodies(v, new Set([1]), [1, 0, 0]);
  const first = v.moving;
  slideBodies(v, new Set([1]), [4, 0, 0]);
  assert.equal(v.moving, first);
  assert.equal(v.model.children.length, 2);
  assert.equal(first.surface.position.x, 4);
});

test("sliding other bodies splits again, and unsplit restores the lists", () => {
  const v = viewport();
  slideBodies(v, new Set([1]), [1, 0, 0]);
  slideBodies(v, new Set([2]), [0, 1, 0]);
  assert.equal(v.model.children.length, 2);
  assert.deepEqual([...v.mesh.geometry.getIndex().array], [0, 1, 2]);
  unsplit(v);
  assert.equal(v.moving, null);
  assert.equal(v.model.children.length, 0);
  assert.deepEqual([...v.mesh.geometry.getIndex().array], [0, 1, 2, 3, 4, 5]);
  assert.equal(v.edgeLines.geometry.getAttribute("position").count, 4);
});

test("bodies with nothing in the mesh change nothing", () => {
  const v = viewport();
  slideBodies(v, new Set([99]), [1, 0, 0]);
  assert.equal(v.moving, null);
  assert.equal(v.model.children.length, 0);
});
