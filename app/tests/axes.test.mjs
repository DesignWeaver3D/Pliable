import test from "node:test";
import assert from "node:assert/strict";
import { axisHalfLength, positionsBox, modelBounds, MIN_HALF_LENGTH } from "../src/axes.ts";

test("an empty scene gets the minimum length", () => {
  assert.equal(axisHalfLength([]), MIN_HALF_LENGTH);
});

test("axes extend past a large box", () => {
  assert.ok(axisHalfLength([[0, 0, 0, 200, 50, 50]]) > 200);
});

test("the longest extent of all boxes decides, not the first", () => {
  const a = axisHalfLength([[0, 0, 0, 10, 10, 10]]);
  const b = axisHalfLength([[0, 0, 0, 10, 10, 10], [-500, 0, 0, -400, 10, 10]]);
  assert.ok(b > a && b >= 500);
});

test("a box far from the origin still reaches it and beyond", () => {
  assert.ok(axisHalfLength([[1000, 1000, 1000, 1010, 1010, 1010]]) > 1010);
});

test("non-finite boxes are ignored", () => {
  assert.equal(axisHalfLength([[NaN, 0, 0, 1, 1, 1]]), MIN_HALF_LENGTH);
});

test("positionsBox", () => {
  assert.deepEqual(positionsBox([1, 2, 3, -1, 5, 0]), [-1, 2, 0, 1, 5, 3]);
  assert.equal(positionsBox([]), null);
});

test("the model box is the core bounds, which still cover hidden bodies", () => {
  // Hidden bodies leave no edge positions, but the bounds stay: the axes keep their length.
  const bounds = [0, 0, 0, 400, 50, 50];
  assert.deepEqual(modelBounds(bounds, []), bounds);
  assert.equal(axisHalfLength([modelBounds(bounds, [])]), axisHalfLength([bounds]));
  assert.ok(axisHalfLength([modelBounds(bounds, [])]) > 400);
});

test("without usable bounds the edge positions give the box", () => {
  assert.deepEqual(modelBounds(undefined, [1, 2, 3, -1, 5, 0]), [-1, 2, 0, 1, 5, 3]);
  assert.deepEqual(modelBounds([NaN, 0, 0, 1, 1, 1], [0, 0, 0, 2, 2, 2]), [0, 0, 0, 2, 2, 2]);
  assert.equal(modelBounds(undefined, []), null);
});
