import test from "node:test";
import assert from "node:assert/strict";
import { crossings, extendLine } from "../src/sketchmodel.ts";
import { trimClick } from "../src/sketchtrim.ts";

const base = () => ({ plane: { origin: [0, 0, 0], normal: [0, 0, 1], xdir: [1, 0, 0] }, points: [], entities: [], constraints: [] });
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);

// An ellipse centered on the origin with semi-axes 10 (along u) and 5, and a horizontal line y = 0 from x = -20 to x = 20.
function withEllipse(arc = false) {
  const s = base();
  s.points.push({ id: 1, u: -20, v: 0 }, { id: 2, u: 20, v: 0 }, { id: 3, u: 0, v: 0 }, { id: 4, u: 10, v: 0 }, { id: 5, u: -10, v: 0 }, { id: 6, u: 0, v: 5 }, { id: 7, u: 0, v: -5 });
  s.entities.push({ id: 10, type: "line", a: 1, b: 2 });
  s.entities.push({ id: 11, type: "ellipse", center: 3, major: 4, major2: 5, minor1: 6, minor2: 7, minor: 5, ...(arc ? { start: 6, end: 5 } : {}) });
  return s;
}

test("a line crosses an ellipse at the ends of its axis", () => {
  const ts = crossings(withEllipse(), withEllipse().entities[0]);
  assert.equal(ts.length, 2);
  near(ts[0] * 40 - 20, -10);
  near(ts[1] * 40 - 20, 10);
});

test("an elliptical arc is crossed only where the arc is", () => {
  const s = withEllipse(true); // counterclockwise from the top to the left end: the upper left quarter
  const ts = crossings(s, s.entities[0]);
  assert.equal(ts.length, 1);
  near(ts[0] * 40 - 20, -10);
});

test("a spline is crossed where it passes the line", () => {
  const s = base();
  s.points.push({ id: 1, u: 0, v: 0 }, { id: 2, u: 10, v: 0 }, { id: 3, u: 5, v: -5 }, { id: 4, u: 5, v: 0.001 }, { id: 5, u: 5, v: 5 });
  s.entities.push({ id: 10, type: "line", a: 1, b: 2 }, { id: 11, type: "spline", points: [3, 4, 5] });
  const ts = crossings(s, s.entities[0]);
  assert.equal(ts.length, 1);
  near(ts[0], 0.5, 1e-3);
});

test("Extend stretches a line to the ellipse", () => {
  const s = withEllipse();
  s.points[0].u = -30;
  s.points[1].u = -15; // the line now stops short of the ellipse at x = -10
  const out = extendLine(s, 10, -15, 0);
  near(out.points.find((p) => p.id === 2).u, -10);
});

test("Trim cuts a line where it crosses an ellipse", () => {
  const s = withEllipse();
  const out = trimClick(s, 10, 0, 0, new Set());
  assert.equal(out.sketch.entities.filter((e) => e.type === "line" && !e.construction).length, 2);
  assert.equal(out.sketch.entities.filter((e) => e.type === "line" && e.construction).length, 1);
});
