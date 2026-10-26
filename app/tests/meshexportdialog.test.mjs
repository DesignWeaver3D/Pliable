import test from "node:test";
import assert from "node:assert/strict";
import { parseOption, LINEAR_RANGE, ANGULAR_RANGE, DEFAULT_LINEAR, DEFAULT_ANGULAR } from "../src/meshexportdialog.ts";

test("typed deflections must be numbers inside the range", () => {
  assert.equal(parseOption("0.003", LINEAR_RANGE), 0.003);
  assert.equal(parseOption(" 0.5 ", ANGULAR_RANGE), 0.5);
  assert.equal(parseOption("", LINEAR_RANGE), null);
  assert.equal(parseOption("abc", LINEAR_RANGE), null);
  assert.equal(parseOption("0", LINEAR_RANGE), null);
  assert.equal(parseOption("3", ANGULAR_RANGE), null);
});

test("the defaults are the slicer's STEP import values and lie in the ranges", () => {
  assert.equal(DEFAULT_LINEAR, 0.003);
  assert.equal(DEFAULT_ANGULAR, 0.5);
  assert.notEqual(parseOption(String(DEFAULT_LINEAR), LINEAR_RANGE), null);
  assert.notEqual(parseOption(String(DEFAULT_ANGULAR), ANGULAR_RANGE), null);
});
