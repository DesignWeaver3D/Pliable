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

test("typed entries take the decimal character of the setting", async () => {
  const { typedStep, typedTravel } = await import("../src/handlemath.ts");
  const { typedKey, parseTyped } = await import("../src/sketchtyped.ts");
  const { TypedFields } = await import("../src/typedentry.ts");
  setDecimalComma(true);
  assert.deepEqual(typedStep("2", false, ","), { text: "2,", negative: false });
  assert.equal(typedStep("2", false, "."), null);
  assert.equal(typedStep("2,5", false, ","), null);
  assert.equal(typedKey("3", ",", 1), "3,");
  assert.equal(typedKey("3", ".", 1), null);
  assert.deepEqual(parseTyped("2,5 4"), [2.5, 4]);
  const f = new TypedFields(1);
  for (const k of ["1", ",", "5"]) f.key(k);
  assert.equal(f.value(0), 1.5);
  assert.equal(typedTravel({ value: 0, scale: 1, min: null, kind: "move" }, "1,5", false), 1.5);
  setDecimalComma(false);
  assert.equal(parseTyped("2,5"), null);
});
