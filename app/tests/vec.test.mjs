import test from "node:test";
import assert from "node:assert/strict";
import { sub3, dot3, cross3, unit3, unit3OrNull, unit2, unit2OrZero } from "../src/vec.ts";
import { unit as unit2Intersect } from "../src/sketchintersect.ts";
import { unit as pullUnit } from "../src/pulldir.ts";

test("3D arithmetic", () => {
  assert.deepEqual(sub3([3, 2, 1], [1, 1, 1]), [2, 1, 0]);
  assert.equal(dot3([1, 2, 3], [4, 5, 6]), 32);
  assert.deepEqual(cross3([1, 0, 0], [0, 1, 0]), [0, 0, 1]);
});

test("unit vectors and the zero-vector variants", () => {
  assert.deepEqual(unit3([0, 3, 4]), [0, 0.6, 0.8]);
  assert.deepEqual(unit3([0, 0, 0]), [0, 0, 0]);
  assert.equal(unit3OrNull([0, 0, 0]), null);
  assert.equal(unit3OrNull([1e-10, 0, 0]), null);
  assert.deepEqual(unit3OrNull([0, 2, 0]), [0, 1, 0]);
  assert.deepEqual(pullUnit([0, 0, 0]), null);
  assert.deepEqual(unit2([3, 4]), [0.6, 0.8]);
  assert.deepEqual(unit2([0, 0]), [0, 0]);
  assert.deepEqual(unit2OrZero([1e-10, 0]), [0, 0]);
  assert.deepEqual(unit2OrZero([0, -2]), [0, -1]);
  assert.deepEqual(unit2Intersect([0, 5]), [0, 1]);
});
