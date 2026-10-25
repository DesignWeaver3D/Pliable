import test from "node:test";
import assert from "node:assert/strict";
import { gridCounts, gridShift, planePoint } from "../src/gridgrip.ts";

const u = [20, 0, 0];
const v = [0, 20, 0];

test("a pointer ray meets the plane of the two steps", () => {
  assert.deepEqual(planePoint([5, 6, 10], [0, 0, -1], [0, 0, 0], u, v), [5, 6, 0]);
  assert.equal(planePoint([0, 0, 10], [1, 0, 0], [0, 0, 0], u, v), null);
  assert.equal(planePoint([0, 0, 10], [0, 0, -1], [0, 0, 0], u, [40, 0, 0]), null);
});

test("moving along one step changes only that count", () => {
  assert.deepEqual(gridCounts([40, 0, 0], u, v, 3, 3), { columns: 5, rows: 3 });
  assert.deepEqual(gridCounts([0, 41, 0], u, v, 3, 3), { columns: 3, rows: 5 });
});

test("columns and rows change independently in one drag", () => {
  assert.deepEqual(gridCounts([20, -20, 0], u, v, 3, 3), { columns: 4, rows: 2 });
});

test("counts never go below one", () => {
  assert.deepEqual(gridCounts([-400, -400, 0], u, v, 3, 3), { columns: 1, rows: 1 });
});

test("skewed steps are split along their own directions", () => {
  assert.deepEqual(gridCounts([30, 10, 0], [20, 0, 0], [10, 10, 0], 2, 2), { columns: 3, rows: 3 });
});

test("the grip follows by whole steps", () => {
  assert.deepEqual(gridShift(u, v, 5, 2, 3, 3), [40, -20, 0]);
});
