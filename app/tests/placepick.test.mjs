// Run with: node --test app/tests
import test from "node:test";
import assert from "node:assert/strict";
import { moveVector, offsetOf, originFor, pointText } from "../src/placepick.ts";

test("the move vector is destination minus base", () => {
  assert.deepEqual(moveVector([1, 2, 3], [4, 6, 3]), [3, 4, 0]);
  assert.deepEqual(moveVector([0, 0, 0], [5, -1, 2]), [5, -1, 2]);
});

test("the origin puts the chosen anchor at the destination", () => {
  // a 10 x 10 x 10 box placed by its centre at (20, 20, 0) starts at (15, 15, -5)
  assert.deepEqual(originFor([20, 20, 0], [5, 5, 5]), [15, 15, -5]);
  assert.deepEqual(originFor([7, 8, 9], [0, 0, 0]), [7, 8, 9]);
});

test("point text is short", () => {
  assert.equal(pointText([1, 2.12345, -0.0004]), "1, 2.123, 0");
});

test("a picked base becomes an offset from the placement point and lands on the destination", () => {
  const offset = offsetOf([40, -7, 25], [3, -2, 1]);
  assert.deepEqual(offset, [37, -5, 24]);
  assert.deepEqual(originFor([1, 2, 3], offset), [-36, 7, -21]);
  assert.deepEqual(offsetOf([3, -2, 1], [3, -2, 1]), [0, 0, 0]);
});

test("move arrows relocate to the picked base point, other handles stay", async () => {
  const { moveHandlesAt } = await import("../src/placepick.ts");
  const hs = [
    { kind: "move", anchor: [0, 0, 0], param: "x" },
    { kind: "resize", anchor: [1, 1, 1], param: "w" },
  ];
  const out = moveHandlesAt(hs, [5, 6, 7]);
  assert.deepEqual(out[0].anchor, [5, 6, 7]);
  assert.deepEqual(out[1].anchor, [1, 1, 1]);
  assert.equal(moveHandlesAt(hs, null), hs);
});
