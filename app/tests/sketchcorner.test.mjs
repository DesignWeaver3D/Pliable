import test from "node:test";
import assert from "node:assert/strict";
import { cornerAt, roundAt } from "../src/sketchcorner.ts";
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
  assert.equal(bevelled.entities.filter((e) => e.type === "line" && !e.construction).length, 3);
  const cuts = bevelled.entities.filter((e) => e.type === "line" && e.construction && e.a === 2 && e.id > 11);
  assert.equal(cuts.length, 2); // the cut-off ends, held equal
  assert.ok(bevelled.constraints.some((c) => c.type === "equal" && cuts.every((e) => c.entities.includes(e.id))));
});

test("rounding a corner keeps the corner point and the old lines as construction, with their constraints", () => {
  const s = { ...l(), constraints: [{ id: 20, type: "distance", points: [1, 2], value: 10 }, { id: 21, type: "distance", points: [2, 3], value: 10 }] };
  const rounded = roundCorner(s, 2, "fillet", 2);
  assert.ok(rounded.points.some((p) => p.id === 2));
  assert.deepEqual(rounded.constraints.filter((c) => c.id === 20 || c.id === 21).length, 2);
  assert.deepEqual(rounded.entities.filter((e) => e.construction).map((e) => e.id), [10, 11]);
  const outline = rounded.entities.filter((e) => e.type === "line" && !e.construction);
  assert.equal(outline.length, 2);
  assert.ok(outline.some((e) => e.a === 1) && outline.some((e) => e.a === 3)); // the far ends are shared with the old lines
  assert.equal(rounded.constraints.filter((c) => c.type === "point_on").length, 2);
  assert.equal(cornerAt(rounded, { kind: "point", id: 2 }, 0, 0), 2); // reported as a corner by id, but its real lines are gone
  assert.equal(typeof roundAt(rounded, 2, "fillet", 1, 0, 0), "string"); // nothing real left to round at the old corner
});

// A line coming in from the left to (0, 0), where an arc (center (10, 0), radius 10) leaves downward, and a second arc beside it.
const lineArc = () => ({
  plane: { origin: [0, 0, 0], normal: [0, 0, 1], xdir: [1, 0, 0] },
  points: [{ id: 1, u: -10, v: 0 }, { id: 2, u: 0, v: 0 }, { id: 3, u: 10, v: 0 }, { id: 4, u: 10, v: -10 }],
  entities: [{ id: 10, type: "line", a: 1, b: 2 }, { id: 11, type: "arc", center: 3, start: 2, end: 4 }],
  constraints: [],
});

test("the corner buttons round and bevel a line meeting an arc, with the corner itself as the pointer", () => {
  const rounded = roundAt(lineArc(), 2, "fillet", 2, 0, 0);
  assert.equal(typeof rounded, "object");
  assert.equal(rounded.entities.filter((e) => e.type === "arc").length, 2);
  assert.ok(rounded.constraints.some((c) => c.type === "tangent"));
  const bevelled = roundAt(lineArc(), 2, "chamfer", 2, 0, 0);
  assert.equal(typeof bevelled, "object");
  assert.equal(bevelled.entities.filter((e) => e.type === "line").length, 2);
  assert.equal(typeof roundAt(lineArc(), 1, "fillet", 2, -10, 0), "string"); // a free end is no corner
});

test("two arcs meeting at a point are rounded and bevelled too", () => {
  const s = {
    plane: { origin: [0, 0, 0], normal: [0, 0, 1], xdir: [1, 0, 0] },
    // one arc rises from (-10, -10) to (0, 0) about (-10, 0); the other leaves (0, 0) to the right about (0, 10)
    points: [{ id: 1, u: -10, v: 0 }, { id: 2, u: 0, v: 0 }, { id: 5, u: -10, v: -10 }, { id: 6, u: 0, v: 10 }, { id: 7, u: 10, v: 10 }],
    entities: [{ id: 10, type: "arc", center: 1, start: 5, end: 2 }, { id: 11, type: "arc", center: 6, start: 2, end: 7 }],
    constraints: [],
  };
  const rounded = roundAt(JSON.parse(JSON.stringify(s)), 2, "fillet", 1, 0, 0);
  assert.equal(typeof rounded, "object");
  assert.equal(rounded.entities.filter((e) => e.type === "arc").length, 3);
  const bevelled = roundAt(JSON.parse(JSON.stringify(s)), 2, "chamfer", 1, 0, 0);
  assert.equal(typeof bevelled, "object");
  assert.equal(bevelled.entities.filter((e) => e.type === "line").length, 1);
});
