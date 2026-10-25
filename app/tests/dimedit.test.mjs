import test from "node:test";
import assert from "node:assert/strict";
import { formatValue, parseValue } from "../src/dimedit.ts";

test("typed dimension values parse numbers only", () => {
  assert.equal(parseValue("12.5"), 12.5);
  assert.equal(parseValue(" -3,5 "), -3.5);
  assert.equal(parseValue(".5"), 0.5);
  assert.equal(parseValue(""), null);
  assert.equal(parseValue("1e3"), null);
  assert.equal(parseValue("12mm"), null);
});

test("shown values drop trailing zeros", () => {
  assert.equal(formatValue(8), "8");
  assert.equal(formatValue(2.50004), "2.5");
  assert.equal(formatValue(1 / 3), "0.3333");
});

test("the draft angle tag of a wall is dropped from the shown dimensions, other dimensions stay", async () => {
  const { withoutDraftTag } = await import("../src/dimedit.ts");
  const dims = [{ kind: "linear", edit: { kind: "edge_length" } }, { kind: "tag", edit: { kind: "face_angle" } }, { kind: "tag" }];
  assert.deepEqual(withoutDraftTag(dims), [dims[0], dims[2]]);
});
