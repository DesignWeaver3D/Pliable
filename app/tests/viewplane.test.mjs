// Run with: node --test app/tests
import test from "node:test";
import assert from "node:assert/strict";
import { viewPlane } from "../src/viewplane.ts";

test("looking down the Z axis gives the XY plane facing up", () => {
  const p = viewPlane([5, 6, 100], [5, 6, 0], [1, 0, 0]);
  assert.deepEqual(p.origin, [5, 6, 0]);
  assert.deepEqual(p.normal, [0, 0, 1]);
  assert.deepEqual(p.xdir, [1, 0, 0]);
});

test("the x axis is square to the normal when the camera looks slantwise", () => {
  const p = viewPlane([10, 10, 10], [0, 0, 0], [0.7, -0.7, 0.1]);
  const dot = p.normal[0] * p.xdir[0] + p.normal[1] * p.xdir[1] + p.normal[2] * p.xdir[2];
  assert.ok(Math.abs(dot) < 1e-12);
  assert.ok(Math.abs(Math.hypot(...p.xdir) - 1) < 1e-12);
});
