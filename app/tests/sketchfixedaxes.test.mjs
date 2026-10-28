import test from "node:test";
import assert from "node:assert/strict";
import { fixedToAxes, axesToFixed } from "../src/sketchfixedaxes.ts";

const sketch = (u, v) => ({
  plane: { origin: [0, 0, 0], normal: [0, 0, 1], xdir: [1, 0, 0] },
  points: [{ id: 1, u: 0, v: 0, fixed: true }, { id: 2, u, v }],
  entities: [],
  constraints: [{ id: 3, type: "fixed", point: 2 }],
});

test("a Fixed point becomes its two distances from the origin, and back", () => {
  const s = sketch(4, -3);
  const made = fixedToAxes(s, 3);
  assert.deepEqual(made.map((c) => [c.type, c.value]), [["horizontal_distance", 4], ["vertical_distance", 3]]);
  const back = axesToFixed({ ...s, constraints: made }, made[0].id);
  assert.deepEqual(back.map((c) => [c.type, c.point]), [["fixed", 2]]);
});

test("a point on an axis is held to it instead of by a zero distance", () => {
  const made = fixedToAxes(sketch(0, 5), 3);
  assert.deepEqual(made.map((c) => c.type), ["vertical", "vertical_distance"]);
});

test("the origin itself and other constraints are left alone", () => {
  const s = sketch(1, 1);
  assert.equal(fixedToAxes({ ...s, constraints: [{ id: 3, type: "fixed", point: 1 }] }, 3), null);
  assert.equal(axesToFixed(s, 3), null);
});
