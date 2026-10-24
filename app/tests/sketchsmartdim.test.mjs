import test from "node:test";
import assert from "node:assert/strict";
import { smartChoices, allConstraintOptions } from "../src/sketchsmartdim.ts";

const plane = { origin: [0, 0, 0], normal: [0, 0, 1], xdir: [1, 0, 0] };
const P = (id, u, v) => ({ id, u, v });
const L = (id, a, b) => ({ id, type: "line", a, b });
const sketch = (points, entities, constraints = []) => ({ plane, points, entities, constraints });
const ent = (...ids) => ids.map((id) => ({ kind: "entity", id }));
const pt = (...ids) => ids.map((id) => ({ kind: "point", id }));
const labels = (s, sel, near = 0.5) => smartChoices(s, sel, near).map((o) => o.label);
const built = (s, sel, label, near = 0.5) => {
  const o = smartChoices(s, sel, near).find((x) => x.label === label);
  return o.buildMany ? o.buildMany(s, sel) : [o.build(s, sel)];
};

const s = sketch(
  [P(1, 0, 0), P(2, 10, 0), P(3, 0, 5), P(4, 10, 5.1), P(5, 3, 3), P(6, 20, 20), P(7, 20.2, 20), P(8, 30, 0), P(9, 35, 0), P(10, 5, 8), P(11, 20, 20)],
  [L(10, 1, 2), L(11, 3, 4), L(12, 2, 4), { id: 13, type: "circle", center: 5, radius: 2 }, { id: 14, type: "circle", center: 6, radius: 3 }, { id: 15, type: "arc", center: 8, start: 9, end: 10 }, { id: 16, type: "circle", center: 11, radius: 1 }, L(17, 1, 3)],
);

test("one item gets its own dimension", () => {
  assert.deepEqual(labels(s, ent(10)), ["Length / distance"]);
  assert.deepEqual(labels(s, ent(13)), ["Diameter"]);
  assert.deepEqual(labels(s, ent(15)), ["Radius"]);
  assert.deepEqual(labels(s, pt(1)), []);
});

test("two points: far apart offer the distances, very near each other a coincident", () => {
  assert.deepEqual(labels(s, pt(1, 2)), ["Length / distance", "Horizontal distance", "Vertical distance"]);
  assert.deepEqual(labels(s, pt(6, 7)), ["Coincident"]);
  assert.deepEqual(built(s, pt(6, 7), "Coincident"), [{ type: "coincident", points: [6, 7] }]);
});

test("two lines: an angle, or the distance between them when they are parallel", () => {
  assert.deepEqual(labels(s, ent(10, 12)), ["Angle"]);
  const parallel = labels(s, ent(10, 11));
  assert.deepEqual(parallel, ["Distance between the lines"]); // 10 and 11 differ by less than a degree
  assert.deepEqual(built(s, ent(10, 11), "Distance between the lines"), [{ type: "point_line_distance", point: 1, entity: 11 }]);
  const withConstraint = sketch(s.points, [L(10, 1, 2), L(12, 2, 4)], [{ id: 50, type: "parallel", entities: [10, 12] }]);
  assert.deepEqual(labels(withConstraint, ent(10, 12)), ["Distance between the lines"]);
});

test("a point with a line or a circle", () => {
  assert.deepEqual(labels(s, [...ent(10), ...pt(10)]), ["Point to line distance"]);
  assert.deepEqual(labels(s, [...ent(10), ...pt(5)], 5), ["Point to line distance", "Point on"]);
  assert.deepEqual(labels(s, [...ent(13), ...pt(1)]), ["Distance to the centre"]);
  assert.deepEqual(labels(s, [...ent(13), ...pt(5)]), []); // its own centre
});

test("circles and arcs: centre distances, or concentric when the centres sit together; a line and a circle", () => {
  assert.deepEqual(labels(s, ent(13, 14)), ["Distance between the centres"]);
  assert.deepEqual(built(s, ent(13, 14), "Distance between the centres"), [{ type: "distance", points: [5, 6] }]);
  assert.deepEqual(labels(s, ent(14, 16)), ["Concentric"]);
  assert.deepEqual(built(s, ent(14, 16), "Concentric"), [{ type: "coincident", points: [6, 11] }]);
  assert.deepEqual(labels(s, ent(13, 10)), ["Centre to line distance"]);
});

test("three or more items offer only constraints that take that many arguments", () => {
  assert.deepEqual(labels(s, [...ent(10), ...pt(3, 4)]), ["Symmetric", "Midpoint"]);
  assert.deepEqual(labels(s, ent(10, 11, 17)), ["Equal length", "Collinear"]);
  assert.deepEqual(built(s, ent(10, 11, 17), "Equal length"), [{ type: "equal", entities: [10, 11] }, { type: "equal", entities: [10, 17] }]);
  assert.deepEqual(labels(s, ent(13, 14, 15)), ["Equal radius", "Concentric"]);
  assert.deepEqual(labels(s, pt(1, 2, 3)), ["Coincident"]);
  assert.deepEqual(labels(s, [...ent(10, 11), ...pt(3)]), []); // nothing takes these
});

test("the smart dimension heads the button list and is enabled when anything fits", () => {
  const all = allConstraintOptions(s, ent(10));
  assert.equal(all[0].option.label, "Dimension");
  assert.equal(all[0].enabled, true);
  assert.equal(allConstraintOptions(s, pt(1))[0].enabled, false);
});
