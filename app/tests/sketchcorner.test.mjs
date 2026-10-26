import test from "node:test";
import assert from "node:assert/strict";
import { cornerAt } from "../src/sketchcorner.ts";
import { roundCorner } from "../src/sketchmodel.ts";

// an L: (0,10) - (0,0) - (10,0), plus a loose line hanging from (10,0)'s far end
const l = () => ({
  plane: { origin: [0, 0, 0], normal: [0, 0, 1], xdir: [1, 0, 0] },
  points: [{ id: 1, u: 0, v: 10 }, { id: 2, u: 0, v: 0 }, { id: 3, u: 10, v: 0 }],
  entities: [{ id: 10, type: "line", a: 1, b: 2 }, { id: 11, type: "line", a: 2, b: 3 }],
  constraints: [],
});

test("a click on a point names it; a click on a line names its nearer end that is a corner", () => {
  const s = l();
  assert.equal(cornerAt(s, { kind: "point", id: 2 }, 0, 0), 2);
  assert.equal(cornerAt(s, { kind: "entity", id: 10 }, 0, 1), 2); // near the corner
  assert.equal(cornerAt(s, { kind: "entity", id: 10 }, 0, 9), 2); // the other end is free, so the only corner
  assert.equal(cornerAt(s, { kind: "entity", id: 5 }, 0, 0), null);
  assert.equal(cornerAt(s, null, 0, 0), null);
});

test("the corner a click names can be rounded and bevelled", () => {
  const rounded = roundCorner(l(), 2, "fillet", 2);
  assert.equal(typeof rounded, "object");
  assert.ok(rounded.entities.some((e) => e.type === "arc"));
  const bevelled = roundCorner(l(), 2, "chamfer", 2);
  assert.equal(bevelled.entities.filter((e) => e.type === "line").length, 3);
});
