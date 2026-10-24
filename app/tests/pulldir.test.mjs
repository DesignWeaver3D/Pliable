import test from "node:test";
import assert from "node:assert/strict";
import { PullDirection, angleFromNormal, edgeVector, leavesFace, outOf, sideFrame, tiltFromDrag, tilted, unit } from "../src/pulldir.ts";

const close = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `${a} vs ${b}`));

test("an edge gives a unit direction, a zero-length one none", () => {
  close(edgeVector([0, 0, 0], [0, 3, 4]), [0, 0.6, 0.8]);
  assert.equal(edgeVector([1, 1, 1], [1, 1, 1]), null);
  assert.equal(unit([0, 0, 0]), null);
});

test("a picked direction is turned to point out of the face", () => {
  close(outOf([0, 0, -1], [0, 0, 1]), [0, 0, 1]);
  close(outOf([1, 0, 1], [0, 0, 1]), [1, 0, 1]);
});

test("a direction along the face is not usable", () => {
  assert.equal(leavesFace([1, 0, 0], [0, 0, 1]), false);
  assert.equal(leavesFace([1, 0, 1], [0, 0, 1]), true);
});

test("the side frame is square to the direction and itself", () => {
  for (const d of [[0, 0, 1], [1, 0, 0], [0.6, 0, 0.8], [0, 1, 0]]) {
    const [a, b] = sideFrame(d);
    for (const [p, q] of [[a, b], [a, d], [b, d]]) assert.ok(Math.abs(p[0] * q[0] + p[1] * q[1] + p[2] * q[2]) < 1e-9);
    assert.ok(Math.abs(Math.hypot(...a) - 1) < 1e-9 && Math.abs(Math.hypot(...b) - 1) < 1e-9);
  }
});

test("tilting toward a side turns the direction in their plane", () => {
  close(tilted([0, 0, 1], [1, 0, 0], Math.PI / 2), [1, 0, 0]);
  close(tilted([0, 0, 1], [1, 0, 0], Math.PI / 4), [Math.SQRT1_2, 0, Math.SQRT1_2]);
  close(tilted([0, 0, 1], [1, 0, 0], -Math.PI / 4), [-Math.SQRT1_2, 0, Math.SQRT1_2]);
});

test("a drag tilts by its arc length over the radius and never lies along the face", () => {
  const out = tiltFromDrag([0, 0, 1], [1, 0, 0], [0, 0, 1], 34, 34); // one radian
  assert.ok(Math.abs(angleFromNormal(out, [0, 0, 1]) - 57.29577951) < 1e-6);
  const far = tiltFromDrag([0, 0, 1], [1, 0, 0], [0, 0, 1], 500, 34); // would reach the face plane
  assert.ok(leavesFace(far, [0, 0, 1]));
});

test("the chosen direction becomes tool parameters, none for the normal", () => {
  const p = new PullDirection();
  assert.deepEqual(p.params(), {});
  let changes = 0;
  p.onChange = () => changes++;
  p.set([0, 0.6, 0.8]);
  assert.deepEqual(p.params(), { ux: 0, uy: 0.6, uz: 0.8 });
  p.reset();
  assert.deepEqual(p.params(), {});
  assert.equal(changes, 1);
});
