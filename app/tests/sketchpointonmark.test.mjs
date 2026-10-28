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
  assert.ok(mark.outward[1] !== 0 && Math.abs(mark.outward[0]) < 1e-9); // off the side of the line
  assert.equal(mark.constraint, 20);
});

test("a mark has other directions to try when its place is taken", () => {
  const s = {
    plane: { origin: [0, 0, 0], normal: [0, 0, 1], xdir: [1, 0, 0] },
    points: [{ id: 1, u: 0, v: 0 }, { id: 2, u: 10, v: 0 }, { id: 3, u: 4, v: 0 }],
    entities: [{ id: 10, type: "line", a: 1, b: 2 }, { id: 11, type: "circle", center: 2, radius: 6 }],
    constraints: [{ id: 20, type: "point_on", point: 3, entity: 10 }, { id: 21, type: "point_on", point: 3, entity: 11 }],
  };
  const [a, b] = constraintMarks(s);
  assert.ok(b.alternatives.length >= 4); // other places to try when the first is taken
});

test("a vertex with a Coincident and a Tangent mark shows them either side of one outside direction", () => {
  // a line leaving the right of a circle, tangent to it where its end sits on the rim
  const s = {
    plane: { origin: [0, 0, 0], normal: [0, 0, 1], xdir: [1, 0, 0] },
    points: [{ id: 1, u: 0, v: 0 }, { id: 2, u: 5, v: 0 }, { id: 3, u: 5, v: 8 }],
    entities: [{ id: 10, type: "circle", center: 1, radius: 5 }, { id: 11, type: "line", a: 2, b: 3 }],
    constraints: [{ id: 20, type: "point_on", point: 2, entity: 10 }, { id: 21, type: "tangent", entities: [10, 11] }],
  };
  const marks = constraintMarks(s);
  const coincident = marks.find((m) => m.constraint === 20);
  const tangent = marks.find((m) => m.constraint === 21);
  const angle = (v) => Math.atan2(v[1], v[0]);
  const gap = angle(coincident.outward) - angle(tangent.outward);
  assert.ok(Math.abs(gap - Math.PI / 2) < 1e-9); // a quarter turn apart, the Coincident on the left
  const middle = (angle(coincident.outward) + angle(tangent.outward)) / 2;
  assert.ok(Math.abs(Math.cos(middle) - 1) < 1e-9); // centred on the outside of the circle, here to the right
});
