import test from "node:test";
import assert from "node:assert/strict";
import { PARAM_HELP, TOOL_PARAM_HELP } from "../src/toolparamhelp.ts";

test("every form field help entry has a label and a tooltip", () => {
  const entries = [...Object.values(PARAM_HELP), ...Object.values(TOOL_PARAM_HELP).flatMap((tool) => Object.values(tool))];
  assert.ok(entries.length > 20);
  for (const entry of entries) {
    assert.equal(typeof entry.label, "string");
    assert.ok(entry.label.length > 0);
    assert.ok(entry.title.length > 0);
  }
});

test("the tool-specific tables name the tools and fields the form looks up", () => {
  assert.deepEqual(Object.keys(TOOL_PARAM_HELP).sort(), ["hole_features", "linear_array"]);
  assert.equal(TOOL_PARAM_HELP.linear_array.count.label, "Columns");
  assert.equal(TOOL_PARAM_HELP.hole_features.diameter.label, "Hole diameter (mm)");
  assert.equal(PARAM_HELP.new_body.label, "new body (1 = separate, 0 = join)");
  assert.deepEqual(Object.keys(PARAM_HELP).sort(), ["axis_edge", "bore_by", "bore_offset", "new_body", "nx", "ny", "nz", "sink_by", "sink_offset"]);
});
