import test from "node:test";
import assert from "node:assert/strict";
import { partsOf } from "../src/bodyparts.ts";
import { filterHidden } from "../src/visibility.ts";

// Two bodies (1: one triangle, 2: one triangle sharing no vertex) and one loose face.
function mesh() {
  return {
    header: {},
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 0, 0, 6, 0, 0, 5, 1, 0, 9, 9, 9, 8, 9, 9, 9, 8, 9]),
    normals: new Float32Array(27).fill(0.5),
    indices: new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]),
    edgePositions: new Float32Array([0, 0, 0, 1, 0, 0, 5, 0, 0, 6, 0, 0]),
    faces: [
      { id: 0, start: 0, count: 3, body: 1 },
      { id: 1, start: 3, count: 3, body: 2 },
      { id: 2, start: 6, count: 3, body: null },
    ],
    edges: [
      { id: 0, start: 0, count: 2, body: 1 },
      { id: 1, start: 2, count: 2, body: 2 },
    ],
    vertices: [],
    centres: [],
    bounds: [0, 0, 0, 1, 1, 1],
  };
}

test("a whole mesh is cut into one part per body with local indices", () => {
  const parts = partsOf(mesh());
  assert.deepEqual(parts.map((p) => p.body), [1, 2, null]);
  assert.deepEqual([...parts[1].indices], [0, 1, 2]);
  assert.deepEqual([...parts[1].positions], [5, 0, 0, 6, 0, 0, 5, 1, 0]);
  assert.deepEqual([...parts[1].edgePositions], [5, 0, 0, 6, 0, 0]);
  assert.equal(parts[1].normals.length, 9);
  assert.deepEqual([...parts[2].edgePositions], []);
});

test("parts the mesh store kept are used as they are, and hiding a body drops its part", () => {
  const kept = [{ body: 1, ref: {}, positions: new Float32Array(0), normals: new Float32Array(0), indices: new Uint32Array(0), edgePositions: new Float32Array(0) }, { body: 2, ref: {}, positions: new Float32Array(0), normals: new Float32Array(0), indices: new Uint32Array(0), edgePositions: new Float32Array(0) }];
  const m = { ...mesh(), parts: kept };
  assert.equal(partsOf(m), kept);
  const shown = filterHidden(m, new Set([2]));
  assert.deepEqual(partsOf(shown).map((p) => p.body), [1]);
  assert.equal(partsOf(shown)[0].ref, kept[0].ref);
});

test("whole meshes give new refs each time, so nothing is taken for unchanged", () => {
  const a = partsOf(mesh());
  const b = partsOf(mesh());
  assert.notEqual(a[0].ref, b[0].ref);
});
