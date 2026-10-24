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
  // far-apart points are never pulled onto one place; three of them are symmetric about the one in the middle
  assert.deepEqual(labels(s, pt(1, 2, 3)), ["Symmetric"]);
  assert.deepEqual(labels(s, pt(6, 7, 11)), ["Symmetric", "Coincident"]);
  assert.deepEqual(labels(s, [...ent(10, 11), ...pt(3)]), []); // nothing takes these
});

test("the smart dimension heads the button list and is enabled when anything fits", () => {
  const all = allConstraintOptions(s, ent(10));
  assert.equal(all[0].option.label, "Dimension");
  assert.equal(all[0].enabled, true);
  assert.equal(allConstraintOptions(s, pt(1))[0].enabled, false);
});

test("each button removed from the strip has its constraint reachable through the smart dimension", async () => {
  const { ABSORBED_BY_SMART } = await import("../src/sketchsmartdim.ts");
  const { CONSTRAINT_OPTIONS } = await import("../src/sketchconstraints.ts");
  const e = sketch(
    [P(1, 0, 0), P(2, 10, 3), P(3, 5, 8), P(4, 30, 30), P(5, 40, 30)],
    [L(10, 1, 2), { id: 11, type: "ellipse", center: 4, major: 5, minor: 2 }],
  );
  // For every removed label: a selection the smart dimension takes, and the label of the fit that builds the same thing.
  const reach = {
    "Length / distance": [ent(10), "Length / distance"],
    "Horizontal distance": [pt(1, 2), "Horizontal distance"],
    "Vertical distance": [pt(1, 2), "Vertical distance"],
    "Short radius": [ent(11), "Short radius"],
    "Point to line distance": [[...ent(10), ...pt(3)], "Point to line distance"],
    Symmetric: [[...ent(10), ...pt(4, 5)], "Symmetric"],
  };
  assert.deepEqual(Object.keys(reach).sort(), Object.keys(ABSORBED_BY_SMART).sort(), "every removed button is covered here");
  for (const [label, [sel, fit]] of Object.entries(reach)) {
    const discrete = CONSTRAINT_OPTIONS.find((o) => o.label === label);
    const smart = smartChoices(e, sel, 0.5).find((o) => o.label === fit);
    assert.ok(discrete && smart, label);
    assert.deepEqual(smart.build(e, sel), discrete.build(e, sel), label);
  }
  const strip = allConstraintOptions(e, ent(10)).map((c) => c.option.label);
  for (const label of Object.keys(ABSORBED_BY_SMART)) assert.ok(!strip.includes(label), label);
  assert.equal(strip[0], "Dimension");
});

test("two points and a fixed point such as the origin are symmetric about it", () => {
  const o = sketch([{ id: 1, u: 0, v: 0, fixed: true }, P(2, -4, 1), P(3, 5, 2)], []);
  assert.deepEqual(labels(o, pt(2, 3, 1)), ["Symmetric"]);
  assert.deepEqual(built(o, pt(2, 3, 1), "Symmetric"), [{ type: "symmetric_point", points: [2, 3], point: 1 }]);
  const free = sketch([P(1, 0, 0), P(2, 10, 0), P(3, 4.9, 0.1)], []);
  assert.deepEqual(built(free, pt(1, 2, 3), "Symmetric"), [{ type: "symmetric_point", points: [1, 2], point: 3 }]);
});

test("projected (reference) geometry can be constrained to, but alone it offers nothing", () => {
  const r = sketch([P(1, 0, 0), P(2, 10, 0), P(3, 0, 5), P(4, 10, 6), P(5, 3, 3)], [{ ...L(10, 1, 2), reference: true }, L(11, 3, 4)]);
  assert.deepEqual(labels(r, ent(10)), []);
  assert.deepEqual(labels(r, ent(10, 11)), ["Angle"]);
  assert.deepEqual(labels(r, [...ent(10), ...pt(5)]), ["Point to line distance"]);
});
