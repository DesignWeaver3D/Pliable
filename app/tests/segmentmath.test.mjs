import test from "node:test";
import assert from "node:assert/strict";
import { projectOnSegment } from "../src/segmentmath.ts";

test("projects inside the segment", () => {
  const h = projectOnSegment(2, 3, 0, 0, 4, 0);
  assert.deepEqual([h.t, h.x, h.y, h.dist], [0.5, 2, 0, 3]);
});

test("clamps to either end", () => {
  assert.equal(projectOnSegment(-5, 0, 0, 0, 4, 0).t, 0);
  assert.equal(projectOnSegment(9, 0, 0, 0, 4, 0).t, 1);
  assert.equal(projectOnSegment(9, 0, 0, 0, 4, 0).dist, 5);
});

test("a zero-length segment is a point", () => {
  const h = projectOnSegment(3, 4, 0, 0, 0, 0);
  assert.deepEqual([h.t, h.dist], [0, 5]);
});

test("a tiny segment projects unless a minimum length is given", () => {
  assert.equal(projectOnSegment(0.0005, 0, 0, 0, 0.0005, 0).t, 1);
  assert.equal(projectOnSegment(0.0005, 0, 0, 0, 0.0005, 0, 1e-6).t, 0);
});
