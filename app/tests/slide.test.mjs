// Run with: node --test app/tests
import test from "node:test";
import assert from "node:assert/strict";
import { bodyCentres, movedBodies } from "../src/slide.ts";

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
