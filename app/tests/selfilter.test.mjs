import test from "node:test";
import assert from "node:assert/strict";
import { faceArea, edgeLength, similarTo, parentBodies } from "../src/selfilter.ts";

// Two unit squares facing +z (faces 1 and 2), one two-by-two square facing +z (face 3) and one unit square facing +x (face 4).
const square = (x, y, z, w, axis) => {
  const p = axis === "z" ? [[x, y, z], [x + w, y, z], [x + w, y + w, z], [x, y + w, z]] : [[x, y, z], [x, y + w, z], [x, y + w, z + w], [x, y, z + w]];
  return p;
};
const quads = [square(0, 0, 0, 1, "z"), square(5, 0, 0, 1, "z"), square(10, 0, 0, 2, "z"), square(0, 0, 0, 1, "x")];
const positions = new Float32Array(quads.flat(2));
const indices = new Uint32Array(quads.flatMap((_, q) => [q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3]));
const normals = [[0, 0, 1], [0, 0, 1], [0, 0, 1], [1, 0, 0]];
const faces = quads.map((_, q) => ({ id: q + 1, start: q * 6, count: 6, normal: normals[q] }));
const edgePositions = new Float32Array([0, 0, 0, 3, 0, 0, 10, 0, 0, 13, 0, 0, 20, 0, 0, 25, 0, 0]);
const edges = [{ id: 1, start: 0, count: 2 }, { id: 2, start: 2, count: 2 }, { id: 3, start: 4, count: 2 }];
const data = { positions, indices, edgePositions, faces, edges };

test("face area and edge length", () => {
  assert.ok(Math.abs(faceArea(data, 0, 6) - 1) < 1e-6);
  assert.ok(Math.abs(faceArea(data, 12, 6) - 4) < 1e-6);
  assert.equal(edgeLength(data, 0, 2), 3);
});

test("similar faces by direction and by area", () => {
  assert.deepEqual(similarTo(data, "faceDirection", 1), [1, 2, 3]);
  assert.deepEqual(similarTo(data, "faceDirection", 4), [4]);
  assert.deepEqual(similarTo(data, "faceArea", 1), [1, 2, 4]);
  assert.deepEqual(similarTo(data, "faceArea", 3), [3]);
});

test("similar edges by length", () => {
  assert.deepEqual(similarTo(data, "edgeLength", 1), [1, 2]);
  assert.deepEqual(similarTo(data, "edgeLength", 3), [3]);
  assert.deepEqual(similarTo(data, "edgeLength", 99), []);
});

test("parentBodies gives each owning body once, for mixed kinds", () => {
  const data = { faces: [{ id: 1, body: 7 }, { id: 2, body: 7 }, { id: 3, body: 9 }], edges: [{ id: 4, body: 11 }], vertices: [{ id: 5, body: 9 }] };
  const items = [{ kind: "face", id: 1 }, { kind: "face", id: 2 }, { kind: "face", id: 3 }, { kind: "edge", id: 4 }, { kind: "vertex", id: 5 }, { kind: "face", id: 99 }];
  assert.deepEqual(parentBodies(data, items).sort((a, b) => a - b), [7, 9, 11]);
  assert.deepEqual(parentBodies(data, []), []);
});

test("a face and an edge can be selected together (Revolve face, Sweep)", async () => {
  const { canJoinSelection } = await import("../src/selfilter.ts");
  assert.equal(canJoinSelection("face", "edge"), true);
  assert.equal(canJoinSelection("edge", "face"), true);
  assert.equal(canJoinSelection("face", "face"), true);
  assert.equal(canJoinSelection("face", "vertex"), false);
});
