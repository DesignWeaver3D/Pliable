import test from "node:test";
import assert from "node:assert/strict";
import { CONSTRAINT_OPTIONS } from "../src/sketchconstraints.ts";

const both = CONSTRAINT_OPTIONS.find((o) => o.label === "Horizontal / vertical");
const sketchOf = (points, entities) => ({ plane: { origin: [0, 0, 0], normal: [0, 0, 1], xdir: [1, 0, 0] }, points, entities, constraints: [] });

test("Horizontal / vertical works on one selected line, by its nearer axis", () => {
  const s = sketchOf(
    [{ id: 1, u: 0, v: 0 }, { id: 2, u: 10, v: 1 }, { id: 3, u: 0, v: 5 }, { id: 4, u: 1, v: 15 }],
    [{ id: 10, type: "line", a: 1, b: 2 }, { id: 11, type: "line", a: 3, b: 4 }],
  );
  assert.deepEqual(both.build(s, [{ kind: "entity", id: 10 }]), { type: "horizontal", entity: 10 });
  assert.deepEqual(both.build(s, [{ kind: "entity", id: 11 }]), { type: "vertical", entity: 11 });
  assert.equal(both.build(s, []), null);
});
