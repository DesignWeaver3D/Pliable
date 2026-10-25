import test from "node:test";
import assert from "node:assert/strict";
import { constraintsFor, releasePoints, sharedAsConstraints, sharedPoints, splitPoint } from "../src/sketchcoincident.ts";

const plane = { origin: [0, 0, 0], normal: [0, 0, 1], xdir: [1, 0, 0] };
const corner = () => ({
  plane,
  points: [{ id: 1, u: 0, v: 0 }, { id: 2, u: 10, v: 0 }, { id: 3, u: 10, v: 10 }, { id: 9, u: 0, v: 0, fixed: true }],
  entities: [{ id: 10, type: "line", a: 1, b: 2 }, { id: 11, type: "line", a: 2, b: 3 }],
  constraints: [{ id: 20, type: "horizontal", entity: 10 }],
});

test("a point shared by two lines is listed as an automatic coincident row", () => {
  assert.deepEqual(sharedPoints(corner()), [{ point: 2, entities: [10, 11] }]);
  const [row] = sharedAsConstraints(corner());
  assert.equal(row.id, -2);
  assert.equal(row.auto, true);
});

test("splitting a shared point leaves both lines with their own end at the same place", () => {
  const s = splitPoint(corner(), 2);
  assert.equal(s.entities.length, 2);
  assert.equal(sharedPoints(s).length, 0);
  const [a, b] = [s.entities[0].b, s.entities[1].a];
  assert.notEqual(a, b);
  const at = (id) => s.points.find((p) => p.id === id);
  assert.deepEqual([at(a).u, at(a).v], [at(b).u, at(b).v]);
});

test("releasing points removes a coincident constraint or splits the shared point, and reports nothing to do", () => {
  const base = corner();
  const apart = { ...base, points: [...base.points, { id: 4, u: 10, v: 10 }], entities: [base.entities[0], { id: 12, type: "line", a: 4, b: 3 }], constraints: [{ id: 21, type: "coincident", points: [2, 4] }] };
  const freed = releasePoints(apart, [2]);
  assert.equal(freed.constraints.length, 0);
  assert.equal(freed.entities.length, 2); // the lines stay
  assert.equal(releasePoints(base, [1]), null);
  assert.equal(releasePoints(base, [2]).entities.length, 2);
});

test("the list shows everything with nothing selected and only what belongs to the selection otherwise", () => {
  const s = corner();
  const all = [...s.constraints, ...sharedAsConstraints(s)];
  assert.equal(constraintsFor(s, all, []).length, 2);
  assert.deepEqual(constraintsFor(s, all, [{ kind: "entity", id: 10 }]).map((c) => c.id), [20, -2]);
  assert.deepEqual(constraintsFor(s, all, [{ kind: "entity", id: 11 }]).map((c) => c.id), [-2]);
  assert.deepEqual(constraintsFor(s, all, [{ kind: "point", id: 3 }]).map((c) => c.id), []);
});
