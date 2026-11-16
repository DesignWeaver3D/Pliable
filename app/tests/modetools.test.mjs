import test from "node:test";
import assert from "node:assert/strict";
import { MODE_GROUPS, MODE_MEMBERS, modeGroupOf, modeGroupTools } from "../src/modetools.ts";

const info = (id) => ({ id, label: id, accepts: { faces: [0, 0], edges: [1, null] }, params: [] });

test("the fillet modes are one drawer entry with the two tools as members", () => {
  const entries = modeGroupTools([info("variable_fillet"), info("fillet_per_edge")]);
  assert.deepEqual(entries.map((e) => e.id), ["fillet_modes"]);
  assert.deepEqual(entries[0].accepts.edges, [1, null]);
  assert.ok(MODE_MEMBERS.has("variable_fillet") && MODE_MEMBERS.has("fillet_per_edge"));
});

test("a member and its group find the same group; others find none", () => {
  assert.equal(modeGroupOf("fillet_per_edge"), MODE_GROUPS[0]);
  assert.equal(modeGroupOf("fillet_modes"), MODE_GROUPS[0]);
  assert.equal(modeGroupOf("push_pull"), null);
});

test("a group whose first mode the core did not list gets no entry", () => {
  assert.deepEqual(modeGroupTools([info("fillet_per_edge")]), []);
});
