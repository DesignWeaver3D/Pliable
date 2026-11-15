import test from "node:test";
import assert from "node:assert/strict";
import { stripIndices, stripPlanes } from "../src/bandstrip.ts";

test("the strip planes keep what lies between the start and the far end", () => {
  const [first, last] = stripPlanes({ origin: [0, 0, 10], direction: [0, 0, -1], length: 4 });
  const kept = (z) => first.distanceToPoint({ x: 0, y: 0, z, isVector3: true }) >= 0 && last.distanceToPoint({ x: 0, y: 0, z, isVector3: true }) >= 0;
  assert.equal(kept(10), true);
  assert.equal(kept(7), true);
  assert.equal(kept(6), true);
  assert.equal(kept(5.9), false);
  assert.equal(kept(10.1), false);
});

test("the strip takes the triangles of the listed faces only", () => {
  const faces = [{ id: 1, start: 0, count: 3 }, { id: 2, start: 3, count: 3 }, { id: 3, start: 6, count: 3 }];
  const index = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  assert.deepEqual([...stripIndices(faces, index, [3, 1, 9])], [0, 1, 2, 6, 7, 8]);
  assert.equal(stripIndices(faces, index, []).length, 0);
});
