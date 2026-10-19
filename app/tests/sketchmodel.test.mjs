import test from "node:test";
import assert from "node:assert/strict";
import { axisLines, polyline, distanceTo, entityPoints } from "../src/sketchmodel.ts";

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

test("ellipses and splines are drawn from their points", () => {
  const s = {
    plane: plane([0, 0, 0], [0, 0, 1], [1, 0, 0]),
    points: [{ id: 1, u: 0, v: 0 }, { id: 2, u: 0, v: 10 }, { id: 3, u: 10, v: 0 }, { id: 4, u: 20, v: 5 }],
    entities: [],
    constraints: [],
  };
  // major axis along v (10 long), minor 4 along u
  const ellipse = { id: 5, type: "ellipse", center: 1, major: 2, minor: 4 };
  const ring = polyline(s, ellipse, 48);
  assert.ok(ring.every(([u, v]) => Math.abs((u / 4) ** 2 + (v / 10) ** 2 - 1) < 1e-9));
  assert.ok(distanceTo(s, ellipse, 4, 0) < 1e-9);
  assert.deepEqual(entityPoints(ellipse), [1, 2]);
  // a spline passes through every one of its points, open or closed
  const spline = { id: 6, type: "spline", points: [1, 3, 4] };
  for (const id of spline.points) assert.ok(distanceTo(s, spline, s.points[id - 1].u, s.points[id - 1].v) < 1e-9);
  const closed = polyline(s, { ...spline, closed: true }, 48);
  assert.deepEqual(closed[0], closed[closed.length - 1]);
  assert.deepEqual(entityPoints(spline), [1, 3, 4]);
});
