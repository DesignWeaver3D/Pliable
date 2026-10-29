// Run with: node --test app/tests
import test from "node:test";
import assert from "node:assert/strict";
import { moveVector, offsetOf, originFor, pointText } from "../src/placepick.ts";

test("the move vector is destination minus base", () => {
  assert.deepEqual(moveVector([1, 2, 3], [4, 6, 3]), [3, 4, 0]);
  assert.deepEqual(moveVector([0, 0, 0], [5, -1, 2]), [5, -1, 2]);
});

test("the origin puts the chosen anchor at the destination", () => {
  // a 10 x 10 x 10 box placed by its center at (20, 20, 0) starts at (15, 15, -5)
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

test("every hole center is a snap candidate unless hidden", async () => {
  const { snapCentres } = await import("../src/placepick.ts");
  const centres = [{ position: [1, 2, 3] }, { position: [9, 9, 9] }];
  assert.equal(snapCentres(centres, () => true).length, 2);
  assert.deepEqual(snapCentres(centres, (p) => p[0] < 5), [[1, 2, 3]]);
});

test("a hole axis is carried onto the face around its mouth", async () => {
  const { axisOnPlane } = await import("../src/placepick.ts");
  // a vertical hole centered at (5, 5, 3) in a plate whose top face is z = 10
  assert.deepEqual(axisOnPlane([5, 5, 3], [0, 0, 1], [0, 0, 10], [0, 0, 1]), [5, 5, 10]);
  assert.equal(axisOnPlane([5, 5, 3], [1, 0, 0], [0, 0, 10], [0, 0, 1]), null);
});

test("hole mouth centers come from the nearest square planes on each side", async () => {
  const { mouthPoints } = await import("../src/placepick.ts");
  const planes = [
    { point: [0, 0, 10], normal: [0, 0, 1] },
    { point: [0, 0, 0], normal: [0, 0, 1] },
    { point: [0, 0, 40], normal: [0, 0, 1] },
    { point: [0, 0, 5], normal: [1, 0, 0] },
  ];
  assert.deepEqual(mouthPoints([5, 5, 5], [0, 0, 1], planes), [[5, 5, 0], [5, 5, 10]]);
});
