import test from "node:test";
import assert from "node:assert/strict";
import { edgeMiddle } from "../src/edgepick.ts";

test("a straight edge gives its middle", () => {
  const p = [0, 0, 0, 10, 0, 0, 5, 5, 5, 5, 5, 9];
  assert.deepEqual(edgeMiddle([{ id: 3, start: 0, count: 2 }, { id: 4, start: 2, count: 2 }], p, 4), [5, 5, 7]);
  assert.deepEqual(edgeMiddle([{ id: 3, start: 0, count: 2 }], p, 3), [5, 0, 0]);
});

test("a polyline gives the point halfway along its length", () => {
  const p = [0, 0, 0, 2, 0, 0, 2, 6, 0]; // 2 then 6: halfway is 4 along, 2 up the second leg
  assert.deepEqual(edgeMiddle([{ id: 1, start: 0, count: 3 }], p, 1), [2, 2, 0]);
});

test("an unknown edge gives null", () => {
  assert.equal(edgeMiddle([], [], 9), null);
});
