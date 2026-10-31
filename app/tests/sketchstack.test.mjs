import test from "node:test";
import assert from "node:assert/strict";
import { unstacked } from "../src/sketchstack.ts";

test("a longer line is cut where a shorter collinear one lies on it", () => {
  const out = unstacked([{ a: [0, 0], b: [10, 0] }, { a: [10, 0], b: [7, 0] }]);
  const total = out.reduce((n, [p, q]) => n + Math.hypot(q[0] - p[0], q[1] - p[1]), 0);
  assert.ok(Math.abs(total - 10) < 1e-9); // every stretch once
  assert.equal(out.length, 2); // the short line, and the long line's remaining 0..7
});

test("lines that are not collinear, and identical lines, are handled", () => {
  assert.equal(unstacked([{ a: [0, 0], b: [10, 0] }, { a: [0, 1], b: [5, 1] }]).length, 2);
  assert.equal(unstacked([{ a: [0, 0], b: [10, 0] }, { a: [0, 0], b: [10, 0] }]).length, 1);
});
