import test from "node:test";
import assert from "node:assert/strict";
import { isArrayTool } from "../src/arrayprompt.ts";

test("only the array tools ask to apply or discard", () => {
  for (const id of ["linear_array", "circular_array", "concentric_array", "path_array"]) assert.equal(isArrayTool(id), true);
  for (const id of ["push_pull", "add_box", "move_body", null]) assert.equal(isArrayTool(id), false);
});
