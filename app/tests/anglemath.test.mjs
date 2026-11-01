import test from "node:test";
import assert from "node:assert/strict";
import { turnCounterclockwise, sweepCounterclockwise, positiveSweep, turnShortWay, TWO_PI } from "../src/anglemath.ts";
import { ellipseSweep, ellipseSweepToward } from "../src/sketchellipse.ts";
import { arcSweepToward, arcBetween } from "../src/sketchshapes.ts";

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} vs ${b}`);

test("counterclockwise turn is in [0, 2 pi)", () => {
  assert.equal(turnCounterclockwise(0), 0);
  assert.equal(turnCounterclockwise(TWO_PI), 0);
  near(turnCounterclockwise(-Math.PI / 2), 1.5 * Math.PI);
  near(turnCounterclockwise(5 * Math.PI), Math.PI);
});

test("counterclockwise sweep is in (0, 2 pi]: the same angle is a full turn", () => {
  assert.equal(sweepCounterclockwise(1, 1), TWO_PI);
  near(sweepCounterclockwise(0, -Math.PI / 2), 1.5 * Math.PI);
  assert.equal(ellipseSweep(0.3, 0.3), TWO_PI);
  near(ellipseSweep(0, Math.PI), Math.PI);
});

test("positive sweep adds a turn unless already positive", () => {
  assert.equal(positiveSweep(0), TWO_PI);
  near(positiveSweep(-1), TWO_PI - 1);
  assert.equal(positiveSweep(2), 2);
});

test("short way is in [-pi, pi): half a turn either way is -pi", () => {
  near(turnShortWay(Math.PI), -Math.PI);
  near(turnShortWay(-Math.PI), -Math.PI);
  near(turnShortWay(Math.PI + 0.1), -Math.PI + 0.1);
  near(turnShortWay(0.5), 0.5);
  assert.equal(turnShortWay(0), 0);
  near(ellipseSweepToward(0, Math.PI), -Math.PI);
  const c = { u: 0, v: 0 };
  near(arcSweepToward(c, { u: 1, v: 0 }, { u: -1, v: 0 }), -Math.PI);
  near(arcSweepToward(c, { u: 1, v: 0 }, { u: 1, v: 0 }), 0);
});

test("arcBetween with the end in the start's direction draws nothing, unlike the sweep helpers", () => {
  const pts = arcBetween({ u: 0, v: 0 }, { u: 1, v: 0 }, { u: 2, v: 0 }, 4);
  for (const p of pts) near(p[0], 1);
});
