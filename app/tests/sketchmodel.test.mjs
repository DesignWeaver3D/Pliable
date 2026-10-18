import test from "node:test";
import assert from "node:assert/strict";
import { axisLines } from "../src/sketchmodel.ts";

const plane = (origin, normal, xdir) => ({ origin, normal, xdir });

test("axes in the plane, parallel to it, and square to it", () => {
  // XY plane lifted by 5: the x and y axes appear as lines under it, the z axis as a point (no line)
  const lifted = axisLines(plane([0, 0, 5], [0, 0, 1], [1, 0, 0]));
  assert.deepEqual(lifted.map((a) => a.axis), [0, 1]);
  assert.ok(lifted.every((a) => Math.abs(a.u) < 1e-9 && Math.abs(a.v) < 1e-9));
  // a plane tilted 45 degrees about y: the x axis projects with a shortened but unit direction
  const s = Math.SQRT1_2;
  const tilted = axisLines(plane([0, 0, 0], [s, 0, s], [s, 0, -s]));
  assert.deepEqual(tilted.map((a) => a.axis), [0, 1, 2]);
  for (const a of tilted) assert.ok(Math.abs(Math.hypot(a.du, a.dv) - 1) < 1e-9);
});
