import test from "node:test";
import assert from "node:assert/strict";
import { segmentPx, mirrorEnd } from "../src/pushpullhit.ts";

test("segmentPx measures to the nearest point of the segment, ends included", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 0 };
  assert.equal(segmentPx({ x: 5, y: 3 }, a, b), 3);
  assert.equal(segmentPx({ x: 14, y: 3 }, a, b), 5);
  assert.equal(segmentPx({ x: -3, y: 4 }, a, b), 5);
  assert.equal(segmentPx({ x: 3, y: 4 }, a, a), 5);
});

test("the red arrow ends opposite the arrow direction, so dragging along it is a negative distance along the normal", () => {
  const end = mirrorEnd([1, 2, 3], [0, 0, 1], 4);
  assert.deepEqual(end, [1, 2, -1]);
  // Drag distance along the face normal of a pointer move to the red end is negative.
  assert.ok((end[2] - 3) * 1 < 0);
});
