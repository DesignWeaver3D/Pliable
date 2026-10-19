// Run with: node --test app/tests
import test from "node:test";
import assert from "node:assert/strict";
import { moveVector, originFor, pointText } from "../src/placepick.ts";

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
