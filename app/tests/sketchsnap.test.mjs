import test from "node:test";
import assert from "node:assert/strict";
import { snap, pick, nearestPoint } from "../src/sketchsnap.ts";

// A stand-in for the sketch mode: the sketch plane is the screen (1 unit = 1 pixel), the pointer is already in sketch units.
function context(tool = "select", extra = {}) {
  return {
    s: { plane: { origin: [0, 0, 0], normal: [0, 0, 1], xdir: [1, 0, 0] }, points: [{ id: 1, u: 0, v: 0 }, { id: 2, u: 100, v: 0 }], entities: [{ id: 10, type: "line", a: 1, b: 2 }], constraints: [] },
    chain: [],
    tool,
    options: { snapGrid: false, major: 10, minor: 0 },
    gridStep() { return 10; },
    planeUV: (e) => [e.clientX, e.clientY],
    screenOf: (u, v) => ({ distanceTo: (m) => Math.hypot(u - m.x, v - m.y) }),
    mousePx: (e) => ({ x: e.clientX, y: e.clientY }),
    pixelAt: () => 1,
    ...extra,
  };
}
const at = (x, y) => ({ clientX: x, clientY: y });

test("the pointer snaps to a point near it, else to a curve, a midpoint or nothing", () => {
  const ctx = context("line");
  assert.equal(nearestPoint(ctx, at(3, 3))?.id, 1);
  assert.deepEqual(snap(ctx, at(2, 2)), { id: 1, u: 0, v: 0 });
  const mid = snap(ctx, at(51, 4));
  assert.deepEqual([mid.u, mid.v, mid.on.midpoint], [50, 0, true]);
  const onLine = snap(ctx, at(30, 4));
  assert.deepEqual([onLine.u, onLine.v, onLine.on.entity], [30, 0, 10]);
  assert.deepEqual(snap(ctx, at(30, 60)), { u: 30, v: 60, axis: undefined });
});

test("snap to grid rounds, and a line near horizontal locks to the last point's level", () => {
  const grid = context("select", { options: { snapGrid: true, major: 10, minor: 0 } });
  assert.deepEqual([snap(grid, at(33, 47)).u, snap(grid, at(33, 47)).v], [30, 50]);
  const ctx = context("line");
  ctx.chain = [{ u: 20, v: 80 }];
  const s = snap(ctx, at(70, 81));
  assert.deepEqual([s.v, s.axis], [80, "h"]);
});

test("pick prefers a point over a curve and finds nothing far away", () => {
  const ctx = context();
  assert.deepEqual(pick(ctx, at(1, 2)), { kind: "point", id: 1 });
  assert.deepEqual(pick(ctx, at(40, 3)), { kind: "entity", id: 10 });
  assert.equal(pick(ctx, at(40, 40)), null);
});
