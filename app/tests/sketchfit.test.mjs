import test from "node:test";
import assert from "node:assert/strict";
import { fitPointsAll, fitPointsSelected } from "../src/sketchfit.ts";

const s = {
  plane: { origin: [0, 0, 5], normal: [0, 0, 1], xdir: [1, 0, 0] },
  points: [{ id: 1, u: 0, v: 0, fixed: true }, { id: 2, u: 10, v: 0 }, { id: 3, u: 10, v: 4 }, { id: 4, u: -20, v: 7 }],
  entities: [{ id: 10, type: "line", a: 2, b: 3 }],
  constraints: [],
};

test("fitting everything uses the sketch's curves and loose points, not the fixed origin", () => {
  const pts = fitPointsAll(s);
  assert.deepEqual(pts, [[10, 0, 5], [10, 4, 5], [-20, 7, 5]]);
  assert.equal(fitPointsAll({ ...s, entities: [], points: [s.points[0]] }), null);
});

test("fitting the selection uses only the selected points and curves", () => {
  assert.deepEqual(fitPointsSelected(s, [{ kind: "entity", id: 10 }]), [[10, 0, 5], [10, 4, 5]]);
  assert.deepEqual(fitPointsSelected(s, [{ kind: "point", id: 4 }]), [[-20, 7, 5]]);
  assert.equal(fitPointsSelected(s, []), null);
});

test("fitting everything in a sketch includes where its dimensions reach", async () => {
  const { dimensionPad } = await import("../src/sketchfit.ts");
  const dimensioned = { ...s, constraints: [{ id: 1, type: "distance", entity: 10, value: 4, place: [30, 2] }] };
  const pts = fitPointsAll(dimensioned);
  assert.ok(pts.length > fitPointsAll(s).length); // the dimension's measured points are added
  assert.equal(dimensionPad(s), 0);
  assert.equal(dimensionPad(dimensioned), 70);
});

test("a small sketch is fitted at its own size, with no minimum", async () => {
  const { fitBoxOf } = await import("../src/sketchfit.ts");
  assert.deepEqual(fitBoxOf([[0, 0, 5], [0.5, 0.2, 5]]), [0, 0, 5, 0.5, 0.2, 5]);
  assert.deepEqual(fitBoxOf([[1, 1, 0]]), [-4, -4, -5, 6, 6, 5]); // a lone point has no extent: only then is the box widened
});
