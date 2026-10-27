import test from "node:test";
import assert from "node:assert/strict";
import { PullDirection, resolvePick, typedTilt, typedTiltKeeping, tiltAlong, angleFromNormal, sideToward, edgeVector, leavesFace, outOf, sideFrame, tiltFromDrag, tilted, unit } from "../src/pulldir.ts";

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

test("an arc side is the face axis made square to the arrow", () => {
  close(sideToward([0, 0, 1], [1, 0, 0]), [1, 0, 0]);
  close(sideToward([0, 0.6, 0.8], [0, 1, 0]), [0, 0.8, -0.6]);
  const s = sideToward([1, 0, 0], [1, 0, 0]); // the axis lies along the arrow: any square side
  assert.ok(Math.abs(s[0]) < 1e-9 && Math.abs(Math.hypot(...s) - 1) < 1e-9);
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

test("a pick of the selected face resets, an edge sets a direction turned out of the face, nothing usable is refused", () => {
  assert.deepEqual(resolvePick(true, null, [0, 0, 1]), { kind: "reset" });
  assert.deepEqual(resolvePick(false, [1, 0.5, -1], [0, 0, 1]), { kind: "set", direction: [-1, -0.5, 1] });
  assert.deepEqual(resolvePick(false, [1, 0, 1], [0, 0, 1]), { kind: "set", direction: [1, 0, 1] });
  assert.deepEqual(resolvePick(false, null, [0, 0, 1]), { kind: "refused" });
});

test("typed degrees tilt from the face normal toward the arc's side, either way, and stop short of the face", () => {
  close(typedTilt([0, 0, 1], [1, 0, 0], 45), [Math.SQRT1_2, 0, Math.SQRT1_2]);
  close(typedTilt([0, 0, 1], [1, 0, 0], -45), [-Math.SQRT1_2, 0, Math.SQRT1_2]);
  close(typedTilt([0, 0, 1], [1, 0, 0], 0), [0, 0, 1]);
  const flat = typedTilt([0, 0, 1], [1, 0, 0], 90);
  assert.ok(leavesFace(flat, [0, 0, 1]) && flat[0] > 0.9);
});

test("typed degrees on one arc keep the other arc's angle, zero on one leaves the other, and the pulled sign is the caller's", () => {
  const n = [0, 0, 1];
  const ex = [1, 0, 0];
  const ey = [0, 1, 0];
  const first = typedTiltKeeping(n, ex, ey, null, 30);
  close([tiltAlong(n, ex, first), tiltAlong(n, ey, first)], [30, 0]);
  const both = typedTiltKeeping(n, ey, ex, first, 20);
  close([tiltAlong(n, ex, both), tiltAlong(n, ey, both)], [30, 20]);
  const zeroed = typedTiltKeeping(n, ex, ey, both, 0);
  close([tiltAlong(n, ex, zeroed), tiltAlong(n, ey, zeroed)], [0, 20]);
  const back = typedTiltKeeping(n, ex, ey, both, -15); // the caller multiplies by -1 when the arc was pulled the negative way
  close([tiltAlong(n, ex, back), tiltAlong(n, ey, back)], [-15, 20]);
  assert.ok(leavesFace(typedTiltKeeping(n, ex, ey, both, 90), n));
});
