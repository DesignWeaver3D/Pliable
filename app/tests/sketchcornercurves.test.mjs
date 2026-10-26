import test from "node:test";
import assert from "node:assert/strict";
import { cornerAt, roundAt, roundPair } from "../src/sketchcorner.ts";
import { pointOf } from "../src/sketchmodel.ts";

const plane = { origin: [0, 0, 0], normal: [0, 0, 1], xdir: [1, 0, 0] };
// a line from (20,0) to the corner (0,0), then a quarter arc about (10,0) from the corner down to (10,-10) (radius 10, counterclockwise)
const lineArc = () => ({
  plane,
  points: [{ id: 1, u: 20, v: 0 }, { id: 2, u: 0, v: 0 }, { id: 3, u: 10, v: 0 }, { id: 4, u: 10, v: -10 }],
  entities: [{ id: 10, type: "line", a: 1, b: 2 }, { id: 11, type: "arc", center: 3, start: 2, end: 4 }],
  constraints: [],
});
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);
const ptsOf = (s, id) => [pointOf(s, id).u, pointOf(s, id).v];

test("a click on an arc names its end that is a corner", () => {
  const s = lineArc();
  assert.equal(cornerAt(s, { kind: "entity", id: 11 }, 0.5, -1), 2);
  assert.equal(cornerAt(s, { kind: "entity", id: 10 }, 18, 0), 2);
});

test("a fillet between a line and an arc is tangent to both and touches them at the tangent points", () => {
  const s = lineArc();
  const made = roundAt(s, 2, "fillet", 3, 3, -3);
  assert.equal(typeof made, "object");
  const arcs = made.entities.filter((e) => e.type === "arc");
  assert.equal(arcs.length, 2);
  const fillet = arcs.find((e) => e.id !== 11);
  const c = ptsOf(made, fillet.center);
  const ts = [ptsOf(made, fillet.start), ptsOf(made, fillet.end)];
  for (const t of ts) near(Math.hypot(t[0] - c[0], t[1] - c[1]), 3);
  // the line now ends on the fillet circle's tangent point with the line: directly above or below the centre
  const line = made.entities.find((e) => e.id === 10);
  const lineEnd = ptsOf(made, line.b);
  near(lineEnd[1], 0);
  near(lineEnd[0], c[0]);
  near(Math.abs(c[1]), 3);
  // the original arc stays on its circle and the fillet arc is tangent to it (distance between centres = 10 +- 3)
  const big = made.entities.find((e) => e.id === 11);
  const bc = ptsOf(made, big.center); // (10,0)
  const d = Math.hypot(c[0] - bc[0], c[1] - bc[1]);
  assert.ok(Math.abs(d - 13) < 1e-6 || Math.abs(d - 7) < 1e-6);
  assert.equal(made.constraints.filter((k) => k.type === "tangent").length, 2);
  assert.ok(!made.points.some((p) => p.id === 2), "the old corner point is gone");
});


test("a chamfer between a line and an arc joins points at the distance along each curve", () => {
  const made = roundAt(lineArc(), 2, "chamfer", 4, 5, 5);
  assert.equal(typeof made, "object");
  const chamfer = made.entities.find((e) => e.type === "line" && e.id > 11);
  const a = ptsOf(made, chamfer.a);
  const b = ptsOf(made, chamfer.b);
  const onLine = [a, b].find((p) => Math.abs(p[1]) < 1e-9);
  near(onLine[0], 4);
  const onArc = [a, b].find((p) => p !== onLine);
  near(Math.hypot(onArc[0] - 10, onArc[1]), 10);
  // 4 along the arc of radius 10 from the corner: 0.4 rad about (10,0)
  near(onArc[0], 10 - 10 * Math.cos(0.4));
  assert.ok(!made.points.some((p) => p.id === 2));
});

test("a fillet between two arcs sharing an end is tangent to both", () => {
  const s = {
    plane,
    points: [{ id: 1, u: -10, v: 10 }, { id: 2, u: 0, v: 0 }, { id: 3, u: 0, v: 10 }, { id: 4, u: 10, v: -10 }, { id: 5, u: 10, v: 0 }],
    entities: [{ id: 10, type: "arc", center: 3, start: 1, end: 2 }, { id: 11, type: "arc", center: 5, start: 2, end: 4 }],
    constraints: [],
  };
  const made = roundAt(s, 2, "fillet", 2, -3, -3);
  assert.equal(typeof made, "object");
  const fillet = made.entities.find((e) => e.type === "arc" && e.id > 11);
  const c = ptsOf(made, fillet.center);
  const d = (id, p) => Math.hypot(c[0] - pointOf(made, id).u, c[1] - pointOf(made, id).v) + 0 * p;
  // tangent to a circle of radius 10 about (0,10) and one about (10,0): the centre distances are 10 +- 2
  const d1 = Math.hypot(c[0], c[1] - 10);
  const d2 = Math.hypot(c[0] - 10, c[1]);
  assert.ok(Math.abs(d1 - 12) < 1e-6 || Math.abs(d1 - 8) < 1e-6);
  assert.ok(Math.abs(d2 - 12) < 1e-6 || Math.abs(d2 - 8) < 1e-6);
  near(d(fillet.start, 0), 2);
  assert.equal(made.constraints.filter((k) => k.type === "tangent").length, 2);
  assert.ok(!made.points.some((p) => p.id === 2));
});


test("a fillet between two lines that cross, picked one after the other, cuts both back", () => {
  const s = {
    plane,
    points: [{ id: 1, u: -10, v: 0 }, { id: 2, u: 10, v: 0 }, { id: 3, u: 0, v: -10 }, { id: 4, u: 0, v: 10 }],
    entities: [{ id: 10, type: "line", a: 1, b: 2 }, { id: 11, type: "line", a: 3, b: 4 }],
    constraints: [],
  };
  const made = roundPair(s, 10, 11, "fillet", 2, 5, 5);
  assert.equal(typeof made, "object");
  const line = made.entities.find((e) => e.id === 10);
  const ends = [ptsOf(made, line.a), ptsOf(made, line.b)];
  assert.ok(ends.some((p) => Math.abs(p[0] - 2) < 1e-9 && Math.abs(p[1]) < 1e-9), "kept side of the quadrant");
  assert.ok(ends.some((p) => Math.abs(p[0] - 10) < 1e-9));
});

test("a fillet between a circle and a line cuts the circle into an arc", () => {
  const s = {
    plane,
    points: [{ id: 1, u: 0, v: 0 }, { id: 2, u: -30, v: 6 }, { id: 3, u: 30, v: 6 }],
    entities: [{ id: 10, type: "circle", center: 1, radius: 10 }, { id: 11, type: "line", a: 2, b: 3 }],
    constraints: [],
  };
  const made = roundPair(s, 10, 11, "fillet", 2, 11, 4);
  assert.equal(typeof made, "object");
  assert.equal(made.entities.find((e) => e.id === 10).type, "arc");
  assert.ok(made.entities.filter((e) => e.type === "arc").length === 2);
});

test("a chamfer of curves that do not meet is refused", () => {
  const s = {
    plane,
    points: [{ id: 1, u: 0, v: 0 }, { id: 2, u: 30, v: 12 }, { id: 3, u: 50, v: 12 }],
    entities: [{ id: 10, type: "circle", center: 1, radius: 10 }, { id: 11, type: "line", a: 2, b: 3 }],
    constraints: [],
  };
  assert.equal(typeof roundPair(s, 10, 11, "chamfer", 2, 20, 12), "string");
});

test("at a corner of an arc and a line only one fillet fits the arms, whatever side the pointer is on", () => {
  const s = lineArc();
  const centre = (m) => ptsOf(m, m.entities.find((e) => e.type === "arc" && e.id !== 11).center);
  assert.deepEqual(centre(roundAt(s, 2, "fillet", 3, 3, 3)), centre(roundAt(s, 2, "fillet", 3, 3, -3)));
});

test("a fillet too large for the arc is refused", () => {
  assert.equal(typeof roundAt(lineArc(), 2, "fillet", 30, 3, -3), "string");
});
