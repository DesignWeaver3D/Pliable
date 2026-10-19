import test from "node:test";
import assert from "node:assert/strict";
import { axisLines, polyline, distanceTo, entityPoints, measure, optionsFor, describeConstraint, dimensionsOf, constraintMarks } from "../src/sketchmodel.ts";

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
  assert.ok(labels([{ kind: "entity", id: 10 }, { kind: "entity", id: 11 }]).includes("Collinear"));
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
