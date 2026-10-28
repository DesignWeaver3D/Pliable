import test from "node:test";
import assert from "node:assert/strict";
import { constraintMarks } from "../src/sketchmodel.ts";

test("a point-on-curve constraint is marked at the point with the Coincident icon", () => {
  const s = {
    plane: { origin: [0, 0, 0], normal: [0, 0, 1], xdir: [1, 0, 0] },
    points: [{ id: 1, u: 0, v: 0 }, { id: 2, u: 10, v: 0 }, { id: 3, u: 4, v: 0 }],
    entities: [{ id: 10, type: "line", a: 1, b: 2 }],
    constraints: [{ id: 20, type: "point_on", point: 3, entity: 10 }],
  };
  const [mark] = constraintMarks(s);
  assert.equal(mark.icon, "Coincident");
  assert.deepEqual(mark.points[0], [4, 0, 0]); // the point, not halfway to the middle of the line
  assert.ok(mark.outward && Math.hypot(...mark.outward) > 0.5); // drawn beside the point, not on it
  assert.equal(mark.constraint, 20);
});

test("two marks at one point leave it in different directions", () => {
  const s = {
    plane: { origin: [0, 0, 0], normal: [0, 0, 1], xdir: [1, 0, 0] },
    points: [{ id: 1, u: 0, v: 0 }, { id: 2, u: 10, v: 0 }, { id: 3, u: 4, v: 0 }],
    entities: [{ id: 10, type: "line", a: 1, b: 2 }, { id: 11, type: "circle", center: 2, radius: 6 }],
    constraints: [{ id: 20, type: "point_on", point: 3, entity: 10 }, { id: 21, type: "point_on", point: 3, entity: 11 }],
  };
  const [a, b] = constraintMarks(s);
  assert.notDeepEqual(a.outward.map((x) => Math.round(x * 100)), b.outward.map((x) => Math.round(x * 100)));
});
