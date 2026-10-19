// Run with: node --test app/tests
import test from "node:test";
import assert from "node:assert/strict";
import { holeAxisPoints } from "../src/holepoints.ts";

test("a hole offers its middle and both axis ends as snap points", () => {
  const pts = holeAxisPoints({ position: [10, 20, 5], axis: [0, 0, 1], length: 10 });
  assert.deepEqual(pts.map(([p, label]) => [p, label]), [
    [[10, 20, 5], "Hole centre"],
    [[10, 20, 0], "Hole axis end"],
    [[10, 20, 10], "Hole axis end"],
  ]);
});

test("a centre without a length has no end points", () => {
  assert.equal(holeAxisPoints({ position: [0, 0, 0], axis: [1, 0, 0] }).length, 1);
});
