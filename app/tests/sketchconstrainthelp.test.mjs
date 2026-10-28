import test from "node:test";
import assert from "node:assert/strict";
import { CONSTRAINT_OPTIONS } from "../src/sketchconstraints.ts";
import { CONSTRAINT_HELP, constraintTip } from "../src/sketchconstrainthelp.ts";

test("every constraint button has a tip saying what it does and what to select", () => {
  for (const o of CONSTRAINT_OPTIONS) {
    assert.ok(CONSTRAINT_HELP[o.label], `${o.label} has no help`);
    assert.match(constraintTip(o.label), /Needs: /);
    assert.doesNotMatch(constraintTip(o.label), /does not fit/);
  }
});
