import test from "node:test";
import assert from "node:assert/strict";
import { stripChoices, CONSTRAINT_GROUPS } from "../src/sketchconstraintgroups.ts";
import { allConstraintOptions } from "../src/sketchsmartdim.ts";
import { SKETCH_CONSTRAINT_KEYS } from "../src/sketchkeys.ts";

const s = { points: [{ id: 1, u: 0, v: 0 }, { id: 2, u: 5, v: 1 }], entities: [{ id: 10, type: "line", a: 1, b: 2 }], constraints: [], nextId: 20 };
const all = allConstraintOptions(s, [{ kind: "entity", id: 10 }]).map((c) => ({ label: c.option.label, enabled: c.enabled }));

test("the strict variants leave the row and become drop lists under Dimension and Horizontal / vertical", () => {
  const row = stripChoices(all);
  const labels = row.map((c) => c.label);
  for (const l of ["Horizontal distance", "Vertical distance", "Horizontal", "Vertical"]) assert.ok(!labels.includes(l), l);
  assert.equal(labels[0], "Dimension");
  assert.deepEqual(row.find((c) => c.label === "Dimension").menu.map((m) => m.label), ["Horizontal distance", "Vertical distance"]);
  assert.deepEqual(row.find((c) => c.label === "Horizontal / vertical").menu.map((m) => m.label), ["Horizontal", "Vertical"]);
  assert.ok(row.find((c) => c.label === "Horizontal / vertical").menu.every((m) => m.enabled));
});

test("every grouped option stays reachable by label and by hotkey", () => {
  const labels = all.map((c) => c.label);
  for (const l of Object.values(CONSTRAINT_GROUPS).flat()) assert.ok(labels.includes(l), l);
  for (const k of SKETCH_CONSTRAINT_KEYS) assert.ok(labels.includes(k.constraint), k.constraint);
});
