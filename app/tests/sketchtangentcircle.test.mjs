import test from "node:test";
import assert from "node:assert/strict";
import { addTangentCircle, pickTangent, tangentCircles } from "../src/sketchtangentcircle.ts";

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);

const triangle = () => ({
  plane: { origin: [0, 0, 0], normal: [0, 0, 1], xdir: [1, 0, 0] },
  // the sides of a right triangle with legs 3 and 4 (hypotenuse 5): the inscribed circle has radius 1
  points: [{ id: 1, u: 0, v: 0 }, { id: 2, u: 4, v: 0 }, { id: 3, u: 0, v: 3 }],
  entities: [{ id: 10, type: "line", a: 1, b: 2 }, { id: 11, type: "line", a: 2, b: 3 }, { id: 12, type: "line", a: 3, b: 1 }],
  constraints: [],
});

test("three lines give the inscribed circle and three excircles", () => {
  const all = tangentCircles(triangle(), [10, 11, 12], null);
  assert.equal(all.length, 4);
  const inner = all.find((o) => o.radius < 1.5);
  near(inner.radius, 1);
  near(inner.centre[0], 1);
  near(inner.centre[1], 1);
});

test("the solution nearest the pointer is made, with its tangent constraints and no radius dimension", () => {
  const made = addTangentCircle(triangle(), [10, 11, 12], null, [1.2, 0.8]);
  const circle = made.entities.find((e) => e.type === "circle");
  near(circle.radius, 1);
  assert.deepEqual(made.constraints.map((c) => c.type), ["tangent", "tangent", "tangent"]);
  const outer = addTangentCircle(triangle(), [10, 11, 12], null, [6, 6]);
  assert.ok(outer.entities.find((e) => e.type === "circle").radius > 1.5);
});

test("a circle between two circles and a line (Apollonius) touches all three", () => {
  const s = {
    plane: { origin: [0, 0, 0], normal: [0, 0, 1], xdir: [1, 0, 0] },
    points: [{ id: 1, u: -20, v: 0 }, { id: 2, u: 20, v: 0 }, { id: 3, u: -5, v: 5 }, { id: 4, u: 6, v: 4 }],
    entities: [{ id: 10, type: "line", a: 1, b: 2 }, { id: 11, type: "circle", center: 3, radius: 3 }, { id: 12, type: "circle", center: 4, radius: 2 }],
    constraints: [],
  };
  const all = tangentCircles(s, [10, 11, 12], null);
  assert.ok(all.length >= 2);
  for (const o of all) {
    const [x, y] = o.centre;
    near(Math.abs(y), o.radius); // touches the line y = 0
    const d1 = Math.hypot(x + 5, y - 5);
    const d2 = Math.hypot(x - 6, y - 4);
    assert.ok(Math.abs(d1 - (3 + o.radius)) < 1e-6 || Math.abs(d1 - Math.abs(3 - o.radius)) < 1e-6);
    assert.ok(Math.abs(d2 - (2 + o.radius)) < 1e-6 || Math.abs(d2 - Math.abs(2 - o.radius)) < 1e-6);
  }
});

test("two curves and a radius: the circle in the corner of two lines, kept with a radius dimension", () => {
  const made = addTangentCircle(triangle(), [10, 12], 0.5, [1, 1]);
  const circle = made.entities.find((e) => e.type === "circle");
  const centre = made.points.find((p) => p.id === circle.center);
  near(centre.u, 0.5);
  near(centre.v, 0.5);
  assert.deepEqual(made.constraints.map((c) => [c.type, c.value]), [["tangent", undefined], ["tangent", undefined], ["radius", 0.5]]);
  assert.equal(typeof addTangentCircle(triangle(), [10, 12], 0, [1, 1]), "string");
});

test("the arc between two curves runs between the touching points with point-on and tangent constraints", () => {
  const made = addTangentCircle(triangle(), [10, 12], 0.5, [1, 1], true);
  const arc = made.entities.find((e) => e.type === "arc");
  const [a, b] = [made.points.find((p) => p.id === arc.start), made.points.find((p) => p.id === arc.end)];
  // touching points (0.5, 0) on the bottom line and (0, 0.5) on the left one; the short way round counterclockwise runs from the left one to the bottom one
  near(a.u, 0);
  near(a.v, 0.5);
  near(b.u, 0.5);
  near(b.v, 0);
  assert.deepEqual(made.constraints.map((c) => c.type), ["point_on", "point_on", "tangent", "tangent", "radius"]);
  assert.equal(addTangentCircle(triangle(), [10, 12], 100, [1, 1], true).constructor, Object); // far larger circles still exist
});

test("no circle of too small a radius between two lines that never get that near", () => {
  const s = triangle();
  s.points.push({ id: 4, u: 0, v: 10 }, { id: 5, u: 4, v: 10 });
  s.entities.push({ id: 13, type: "line", a: 4, b: 5 });
  assert.equal(typeof addTangentCircle(s, [10, 13], 3, [2, 5]), "string"); // parallel lines 10 apart: radius 3 cannot touch both
});

test("picking: three curves make the circle at the third pick; two curves then empty space use the radius; the arc tool needs two then any click", () => {
  const s = triangle();
  const hit = (id) => ({ kind: "entity", id });
  let step = pickTangent(s, [], hit(10), [1, 1], "tancircle", 0.5);
  assert.deepEqual(step.picks, [10]);
  step = pickTangent(s, step.picks, hit(11), [1, 1], "tancircle", 0.5);
  step = pickTangent(s, step.picks, hit(12), [1, 1], "tancircle", 0.5);
  assert.deepEqual(step.picks, []);
  near(step.made.entities.find((e) => e.type === "circle").radius, 1);
  const two = pickTangent(s, [10, 12], null, [1, 1], "tancircle", 0.5);
  near(two.made.entities.find((e) => e.type === "circle").radius, 0.5);
  const arc = pickTangent(s, [10, 12], hit(11), [1, 1], "tanarc", 0.5); // a click on a third curve still places the arc
  assert.ok(arc.made.entities.some((e) => e.type === "arc"));
  assert.equal(pickTangent(s, [], null, [1, 1], "tanarc", 0.5).message.startsWith("Pick two"), true);
  assert.deepEqual(pickTangent(s, [10], hit(10), [1, 1], "tancircle", 0.5).picks, [10]); // the same curve twice is ignored
});
