import test from "node:test";
import assert from "node:assert/strict";
import { axisLines, polyline, distanceTo, entityPoints, measure, optionsFor, describeConstraint, dimensionsOf, constraintMarks, sketchAxes } from "../src/sketchmodel.ts";

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

test("reference dimensions read the current geometry and the new constraint buttons fit their selections", () => {
  const s = {
    plane: plane([0, 0, 0], [0, 0, 1], [1, 0, 0]),
    points: [{ id: 1, u: 0, v: 0 }, { id: 2, u: 10, v: 0 }, { id: 3, u: 4, v: 3 }, { id: 4, u: 0, v: 5 }, { id: 5, u: 10, v: 5 }],
    entities: [{ id: 10, type: "line", a: 1, b: 2 }, { id: 11, type: "line", a: 4, b: 5 }],
    constraints: [],
  };
  assert.equal(measure(s, { id: 1, type: "point_line_distance", point: 3, entity: 10 }), 3);
  assert.equal(measure(s, { id: 2, type: "distance", entity: 10 }), 10);
  const labels = (sel) => optionsFor(s, sel).map((o) => o.label);
  assert.ok(labels([{ kind: "entity", id: 10 }, { kind: "entity", id: 11 }]).includes("Tangent / collinear"));
  assert.ok(labels([{ kind: "point", id: 3 }, { kind: "entity", id: 10 }]).includes("Point to line distance"));
  assert.ok(labels([{ kind: "entity", id: 10 }]).includes("Lock"));
  const reference = { id: 3, type: "distance", points: [1, 3], value: 99, reference: true };
  assert.match(describeConstraint(s, reference), /Reference .* = 5$/);
  const [dimension] = dimensionsOf({ ...s, constraints: [reference] });
  assert.equal(dimension.text, "(5)");
});

test("constraint marks sit on the geometry they hold", () => {
  const s = {
    plane: plane([0, 0, 0], [0, 0, 1], [1, 0, 0]),
    points: [{ id: 1, u: 0, v: 0 }, { id: 2, u: 10, v: 0 }],
    entities: [{ id: 10, type: "line", a: 1, b: 2 }],
    constraints: [{ id: 1, type: "horizontal", entity: 10 }, { id: 2, type: "distance", entity: 10, value: 10 }, { id: 3, type: "fixed", point: 1 }],
  };
  const marks = constraintMarks(s);
  assert.deepEqual(marks.map((m) => m.text), ["H", "Fix"]); // dimensions are drawn as dimensions, not marks
  assert.deepEqual(marks[0].points[0], [5, 0, 0]);
  assert.deepEqual(marks[1].points[0], [0, 0, 0]);
});

test("an ellipse offers a short radius dimension that reads its minor axis", () => {
  const s = {
    plane: plane([0, 0, 0], [0, 0, 1], [1, 0, 0]),
    points: [{ id: 1, u: 0, v: 0 }, { id: 2, u: 10, v: 0 }],
    entities: [{ id: 10, type: "ellipse", center: 1, major: 2, minor: 3 }],
    constraints: [],
  };
  assert.ok(optionsFor(s, [{ kind: "entity", id: 10 }]).some((o) => o.label === "Short radius"));
  assert.equal(measure(s, { id: 1, type: "minor_radius", entity: 10 }), 3);
  const [tag] = dimensionsOf({ ...s, constraints: [{ id: 1, type: "minor_radius", entity: 10, value: 3 }] });
  assert.deepEqual(tag.points[0].map((x) => Math.round(x * 1e6) / 1e6), [0, 3, 0]);
});

test("the sketch's own axes pass through its origin and take the colour of the nearest model axis", () => {
  // a plane on a face of a part standing on its side: u runs along model y, v along model z
  const axes = sketchAxes(plane([30, 5, 8], [1, 0, 0], [0, 1, 0]));
  assert.deepEqual(axes.map((a) => [a.u, a.v, a.du, a.dv]), [[0, 0, 1, 0], [0, 0, 0, 1]]);
  assert.deepEqual(axes.map((a) => a.axis), [1, 2]);
});

import { forSolver } from "../src/sketchmodel.ts";

test("forSolver leaves out reference curves and fixed points nothing uses", () => {
  const s = {
    plane: {},
    points: [{ id: 1, u: 0, v: 0, fixed: true }, { id: 2, u: 5, v: 0 }, { id: 3, u: 5, v: 5 }, { id: 4, u: 9, v: 9, fixed: true }, { id: 5, u: 9, v: 0, fixed: true }, { id: 6, u: 1, v: 1, fixed: true }],
    entities: [{ id: 10, type: "line", a: 2, b: 3 }, { id: 11, type: "line", a: 4, b: 5, reference: true }, { id: 12, type: "line", a: 5, b: 6, reference: true }],
    constraints: [{ id: 20, type: "coincident", points: [3, 1] }, { id: 21, type: "parallel", entities: [10, 12] }],
  };
  const out = forSolver(s);
  assert.deepEqual(out.points.map((p) => p.id), [1, 2, 3, 5, 6]);
  assert.deepEqual(out.entities.map((e) => e.id), [10, 12]);
});

test("horizontal and vertical apply to several selected lines, each as detected", () => {
  const s = {
    plane: plane([0, 0, 0], [0, 0, 1], [1, 0, 0]),
    points: [{ id: 1, u: 0, v: 0 }, { id: 2, u: 10, v: 1 }, { id: 3, u: 12, v: 0 }, { id: 4, u: 11, v: 9 }],
    entities: [{ id: 10, type: "line", a: 1, b: 2 }, { id: 11, type: "line", a: 3, b: 4 }],
    constraints: [],
  };
  const sel = [{ kind: "entity", id: 10 }, { kind: "entity", id: 11 }];
  const labels = optionsFor(s, sel).map((o) => o.label);
  assert.deepEqual(labels.slice(0, 3), ["Horizontal / vertical", "Horizontal", "Vertical"]);
  const byLabel = (l) => optionsFor(s, sel).find((o) => o.label === l);
  assert.deepEqual(byLabel("Horizontal / vertical").buildMany(s, sel), [{ type: "horizontal", entity: 10 }, { type: "vertical", entity: 11 }]);
  assert.deepEqual(byLabel("Vertical").buildMany(s, sel), [{ type: "vertical", entity: 10 }, { type: "vertical", entity: 11 }]);
  // one line keeps the old single button and no combined one
  assert.ok(!optionsFor(s, [sel[0]]).some((o) => o.label === "Horizontal / vertical"));
  // a line that already has one is left out
  const held = { ...s, constraints: [{ id: 5, type: "horizontal", entity: 10 }] };
  assert.deepEqual(optionsFor(held, sel).find((o) => o.label === "Vertical").buildMany(held, sel), [{ type: "vertical", entity: 11 }]);
});

test("coincident joins several points, and puts points on an edge", () => {
  const s = {
    plane: plane([0, 0, 0], [0, 0, 1], [1, 0, 0]),
    points: [{ id: 1, u: 0, v: 0 }, { id: 2, u: 10, v: 0 }, { id: 3, u: 1, v: 1 }, { id: 4, u: 2, v: 2 }, { id: 5, u: 5, v: 3 }],
    entities: [{ id: 10, type: "line", a: 1, b: 2 }],
    constraints: [],
  };
  const co = (sel, state = s) => optionsFor(state, sel).find((o) => o.label === "Coincident")?.buildMany(state, sel);
  const P = (...ids) => ids.map((id) => ({ kind: "point", id }));
  assert.deepEqual(co(P(3, 4, 5)), [{ type: "coincident", points: [3, 4] }, { type: "coincident", points: [3, 5] }]);
  // points already joined are not joined again
  const joined = { ...s, constraints: [{ id: 9, type: "coincident", points: [3, 4] }] };
  assert.deepEqual(co(P(3, 4, 5), joined), [{ type: "coincident", points: [3, 5] }]);
  // points with an edge: each point goes on the edge, except its own end points
  assert.deepEqual(co([...P(1, 3, 4), { kind: "entity", id: 10 }]), [{ type: "point_on", point: 3, entity: 10 }, { type: "point_on", point: 4, entity: 10 }]);
  assert.equal(co(P(3)), undefined);
});

test("tangent / collinear picks the constraint from the selection", () => {
  const s = {
    plane: plane([0, 0, 0], [0, 0, 1], [1, 0, 0]),
    points: [{ id: 1, u: 0, v: 0 }, { id: 2, u: 10, v: 0 }, { id: 3, u: 20, v: 0 }, { id: 4, u: 30, v: 0 }, { id: 5, u: 10, v: 10 }, { id: 6, u: 20, v: 10 }, { id: 7, u: 10, v: 5 }, { id: 8, u: 0, v: 20 }, { id: 9, u: 5, v: 20 }],
    entities: [
      { id: 10, type: "line", a: 1, b: 2 }, { id: 11, type: "line", a: 3, b: 4 }, { id: 12, type: "arc", center: 7, start: 2, end: 5 },
      { id: 13, type: "line", a: 5, b: 6 }, { id: 14, type: "line", a: 8, b: 9 },
    ],
    constraints: [],
  };
  const E = (...ids) => ids.map((id) => ({ kind: "entity", id }));
  const many = (sel) => optionsFor(s, sel).find((o) => o.label === "Tangent / collinear")?.buildMany(s, sel);
  assert.deepEqual(many(E(10, 11)), [{ type: "collinear", entities: [10, 11] }]);
  assert.deepEqual(many(E(10, 11, 14)), [{ type: "collinear", entities: [10, 11] }, { type: "collinear", entities: [10, 14] }]);
  assert.deepEqual(many(E(10, 12)), [{ type: "tangent", entities: [10, 12] }]);
  // a chain line-arc-line: only the pairs that meet are made tangent
  assert.deepEqual(many(E(10, 12, 13)), [{ type: "tangent", entities: [10, 12] }, { type: "tangent", entities: [12, 13] }]);
  assert.equal(many(E(10)), undefined);
});

test("the smart dimension picks the dimension from the selection", () => {
  const s = {
    plane: plane([0, 0, 0], [0, 0, 1], [1, 0, 0]),
    points: [{ id: 1, u: 0, v: 0 }, { id: 2, u: 10, v: 0 }, { id: 3, u: 0, v: 10 }, { id: 4, u: 5, v: 5 }, { id: 5, u: 8, v: 5 }],
    entities: [{ id: 10, type: "line", a: 1, b: 2 }, { id: 11, type: "line", a: 1, b: 3 }, { id: 12, type: "circle", center: 4, radius: 2 }, { id: 13, type: "arc", center: 4, start: 5, end: 3 }],
    constraints: [],
  };
  const smart = (sel) => optionsFor(s, sel).find((o) => o.label === "Dimension")?.pick(s, sel)?.build(s, sel);
  const E = (...ids) => ids.map((id) => ({ kind: "entity", id }));
  assert.deepEqual(smart(E(10)), { type: "distance", entity: 10 });
  assert.deepEqual(smart([{ kind: "point", id: 1 }, { kind: "point", id: 4 }]), { type: "distance", points: [1, 4] });
  assert.deepEqual(smart(E(12)), { type: "diameter", entity: 12 });
  assert.deepEqual(smart(E(13)), { type: "radius", entity: 13 });
  assert.deepEqual(smart(E(10, 11)), { type: "angle", entities: [10, 11] });
  assert.deepEqual(smart([{ kind: "point", id: 4 }, ...E(10)]), { type: "point_line_distance", point: 4, entity: 10 });
  assert.equal(smart(E(12, 13)), undefined);
  // a line also offers its angle to the horizontal axis, read from the geometry
  const axis = optionsFor(s, E(11)).find((o) => o.label === "Angle to horizontal axis");
  assert.equal(axis.initial(s, E(11)), 90);
  assert.equal(measure(s, { id: 1, type: "axis_angle", entity: 10 }), 0);
});

test("every dimension drawn on the sketch names its constraint, so it can be edited there", () => {
  const s = {
    plane: plane([0, 0, 0], [0, 0, 1], [1, 0, 0]),
    points: [{ id: 1, u: 0, v: 0 }, { id: 2, u: 10, v: 0 }, { id: 3, u: 5, v: 5 }],
    entities: [{ id: 10, type: "line", a: 1, b: 2 }, { id: 11, type: "circle", center: 3, radius: 2 }],
    constraints: [
      { id: 20, type: "distance", entity: 10, value: 10 }, { id: 21, type: "diameter", entity: 11, value: 4 },
      { id: 22, type: "axis_angle", entity: 10, value: 0 }, { id: 23, type: "horizontal_distance", entity: 10, value: 10 },
    ],
  };
  assert.deepEqual(dimensionsOf(s).map((d) => d.constraint), [20, 21, 22, 23]);
});

test("constraints that only apply to edges ignore selected vertices", () => {
  const s = {
    plane: plane([0, 0, 0], [0, 0, 1], [1, 0, 0]),
    points: [{ id: 1, u: 0, v: 0 }, { id: 2, u: 10, v: 0 }, { id: 3, u: 4, v: 3 }, { id: 4, u: 0, v: 5 }, { id: 5, u: 10, v: 5 }],
    entities: [{ id: 10, type: "line", a: 1, b: 2 }, { id: 11, type: "line", a: 4, b: 5 }],
    constraints: [],
  };
  const labels = (sel) => optionsFor(s, sel).map((o) => o.label);
  const lines = [{ kind: "entity", id: 10 }, { kind: "entity", id: 11 }];
  const stray = [...lines, { kind: "point", id: 3 }];
  for (const label of ["Horizontal", "Vertical", "Parallel", "Perpendicular", "Equal"]) assert.equal(labels(stray).includes(label), labels(lines).includes(label), label);
  assert.ok(labels(stray).includes("Horizontal"));
  assert.ok(labels([{ kind: "entity", id: 10 }, { kind: "point", id: 3 }]).includes("Horizontal"));
});

test("a length dimension sits outside the closed regions and follows where it was dragged", () => {
  const s = {
    plane: plane([0, 0, 0], [0, 0, 1], [1, 0, 0]),
    points: [{ id: 1, u: 0, v: 0 }, { id: 2, u: 10, v: 0 }],
    entities: [{ id: 10, type: "line", a: 1, b: 2 }],
    constraints: [{ id: 20, type: "distance", entity: 10, value: 10 }],
  };
  const regionAbove = { inside: (u, v) => v > 0, probe: 2 };
  const regionBelow = { inside: (u, v) => v < 0, probe: 2 };
  assert.ok(dimensionsOf(s, regionAbove)[0].offsetDirection[1] < 0, "region above: the dimension goes below");
  assert.ok(dimensionsOf(s, regionBelow)[0].offsetDirection[1] > 0, "region below: the dimension goes above");
  // dragged: the line sits at the dropped distance, the text slid along it
  s.constraints[0].place = [7, 4];
  const placed = dimensionsOf(s)[0];
  assert.ok(Math.abs(Math.abs(placed.offset) - 4) < 1e-9);
  assert.ok(Math.abs(placed.slide - 2) < 1e-9);
});
