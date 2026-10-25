// Run with: node --test app/tests
import test from "node:test";
import assert from "node:assert/strict";
import { datumCorners } from "../src/datumcorners.ts";

test("a datum plane is drawn as a square about its origin, in its own plane", () => {
  const corners = datumCorners({ origin: [0, 0, 5], normal: [0, 0, 1], xdir: [1, 0, 0] }, 10);
  assert.equal(corners.length, 4);
  for (const c of corners) assert.equal(c[2], 5);
  assert.deepEqual(corners.map((c) => [c[0], c[1]]), [[-10, -10], [10, -10], [10, 10], [-10, 10]]);
});
