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

test("each piece names the line it is part of, so marked lines can be drawn apart", async () => {
  const { unstackedByLine } = await import("../src/sketchstack.ts");
  // A long line (index 0) with a shorter one (index 1) lying on its middle.
  const out = unstackedByLine([{ a: [0, 0], b: [10, 0] }, { a: [4, 0], b: [6, 0] }]);
  const of = (line) => out.filter((p) => p.line === line).map((p) => [p.piece[0][0], p.piece[1][0]]);
  assert.deepEqual(of(1), [[4, 6]]);
  assert.deepEqual(of(0), [[0, 4], [6, 10]]);
  assert.deepEqual(unstacked([{ a: [0, 0], b: [10, 0] }, { a: [4, 0], b: [6, 0] }]), out.map((p) => p.piece));
});
