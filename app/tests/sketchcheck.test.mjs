import test from "node:test";
import assert from "node:assert/strict";
import { describeProblems, findGaps, joinGaps, openEnds } from "../src/sketchcheck.ts";

const sketch = () => ({
  plane: { origin: [0, 0, 0], normal: [0, 0, 1], xdir: [1, 0, 0] },
  points: [{ id: 1, u: 0, v: 0 }, { id: 2, u: 100, v: 0 }, { id: 3, u: 100.2, v: 0.1 }, { id: 4, u: 100, v: 50 }],
  entities: [{ id: 10, type: "line", a: 1, b: 2 }, { id: 11, type: "line", a: 3, b: 4 }],
  constraints: [{ id: 20, type: "vertical", entity: 11 }, { id: 21, type: "coincident", points: [2, 3] }],
});

test("nearly touching points are found and joined, dropping the constraint that tied them", () => {
  const s = sketch();
  s.constraints.pop();
  const gaps = findGaps(s);
  assert.deepEqual(gaps.map((g) => [g.keep, g.drop]), [[2, 3]]);
  const joined = joinGaps(s, gaps);
  assert.equal(joined.points.length, 3);
  assert.equal(joined.entities.find((e) => e.id === 11).a, 2);
  assert.match(describeProblems(s), /1 pair of points nearly touch/);
});

test("an end that meets nothing is open; one tied by a coincident constraint is not", () => {
  const s = sketch();
  assert.deepEqual(openEnds(s).sort(), [1, 4]);
  s.constraints = [];
  assert.deepEqual(openEnds(s).sort(), [1, 2, 3, 4]);
});

test("joining points that coincide already removes the redundant constraint and zero-length lines", () => {
  const s = sketch();
  s.points[2] = { id: 3, u: 100, v: 0 };
  s.entities.push({ id: 12, type: "line", a: 2, b: 3 });
  const gaps = [{ keep: 2, drop: 3, distance: 0 }];
  const joined = joinGaps(s, gaps);
  assert.equal(joined.entities.some((e) => e.id === 12), false);
  assert.equal(joined.constraints.some((c) => c.type === "coincident"), false);
});
