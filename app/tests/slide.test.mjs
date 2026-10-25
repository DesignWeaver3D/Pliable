// Run with: node --test app/tests
import test from "node:test";
import assert from "node:assert/strict";
import { bodyCentres, movedBodies, splitDrawLists } from "../src/slide.ts";

const data = {
  indices: Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8]),
  edgePositions: Float32Array.from([0, 0, 0, 1, 0, 0, 5, 5, 5, 6, 5, 5]),
  faces: [
    { start: 0, count: 3, body: 1 },
    { start: 3, count: 6, body: 2 },
  ],
  edges: [
    { start: 0, count: 2, body: 1 },
    { start: 2, count: 2, body: 2 },
  ],
};

test("a mesh splits into the bodies that slide and the rest", () => {
  const parts = splitDrawLists(data, new Set([2]));
  assert.deepEqual([...parts.movingIndices], [3, 4, 5, 6, 7, 8]);
  assert.deepEqual([...parts.restIndices], [0, 1, 2]);
  assert.deepEqual([...parts.movingEdges], [5, 5, 5, 6, 5, 5]);
  assert.deepEqual([...parts.restEdges], [0, 0, 0, 1, 0, 0]);
  assert.equal(splitDrawLists(data, new Set([9])), null);
});

test("bodies that shifted along the arrow are the moving ones", () => {
  const v = (body, x, y) => ({ body, position: [x, y, 0] });
  const before = bodyCentres([v(1, 0, 0), v(1, 2, 0), v(2, 10, 10)]);
  const after = bodyCentres([v(1, 3, 0), v(1, 5, 0), v(2, 10, 10)]);
  assert.deepEqual([...movedBodies(before, after, [1, 0, 0])], [1]);
  assert.equal(movedBodies(before, after, [0, 1, 0]), null); // shifted along X, not along the Y arrow
});

test("a body whose hole moves is not slid with the hole", () => {
  const before = new Map([[1, [0, 0, 0]], [2, [5, 5, 5]]]);
  // Body 1 only has a hole moved by 10 (its mean shifts 0.5 along X); body 2 really moved by 10.
  const after = new Map([[1, [0.5, 0, 0]], [2, [15, 5, 5]]]);
  assert.deepEqual([...movedBodies(before, after, [1, 0, 0])].sort(), [1, 2]); // without the travel, both look moved
  assert.deepEqual([...movedBodies(before, after, [1, 0, 0], 1e-4, 10)], [2]);
  assert.equal(movedBodies(new Map([[1, [0, 0, 0]]]), new Map([[1, [0.5, 0, 0]]]), [1, 0, 0], 1e-4, 10), null);
});
