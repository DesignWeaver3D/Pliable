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
