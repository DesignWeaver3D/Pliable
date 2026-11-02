import test from "node:test";
import assert from "node:assert/strict";
import { parseNumber, allowedChars, setDecimalComma, decimalChar } from "../src/numberformat.ts";

test("point mode reads digits, a sign and one point", () => {
  setDecimalComma(false);
  assert.equal(parseNumber("12.5"), 12.5);
  assert.equal(parseNumber(" -3.5 "), -3.5);
  assert.equal(parseNumber("+4"), 4);
  assert.equal(parseNumber(".5"), 0.5);
  assert.equal(parseNumber("5."), 5);
  assert.equal(parseNumber("0"), 0);
});

test("point mode refuses everything else, including a comma", () => {
  setDecimalComma(false);
  for (const bad of ["", "  ", "-", ".", "1,5", "1,000", "1e3", "0x10", "12mm", "1.2.3", "--1", "NaN", "Infinity", "abc"]) {
    assert.equal(parseNumber(bad), null, bad);
  }
});

test("comma mode reads a comma and refuses the point", () => {
  setDecimalComma(true);
  assert.equal(parseNumber("12,5"), 12.5);
  assert.equal(parseNumber("-,5"), -0.5);
  assert.equal(parseNumber("12.5"), null);
  assert.equal(parseNumber("1,2,3"), null);
  setDecimalComma(false);
});

test("typed characters follow the setting", () => {
  setDecimalComma(false);
  assert.equal(decimalChar(), ".");
  assert.equal(allowedChars("."), true);
  assert.equal(allowedChars(","), false);
  assert.equal(allowedChars("7"), true);
  assert.equal(allowedChars("e"), false);
  setDecimalComma(true);
  assert.equal(allowedChars(","), true);
  assert.equal(allowedChars("."), false);
  setDecimalComma(false);
});
