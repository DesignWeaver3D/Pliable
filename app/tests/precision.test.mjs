import test from "node:test";
import assert from "node:assert/strict";
import { setDecimals, showNumber, decimals } from "../src/precision.ts";

test("numbers show at most the chosen decimals and never trailing zeros", () => {
  setDecimals(3);
  assert.equal(showNumber(10), "10");
  assert.equal(showNumber(1.23456), "1.235");
  assert.equal(showNumber(-0.0001), "0");
  setDecimals(8);
  assert.equal(showNumber(1.23456789012), "1.23456789");
  assert.equal(showNumber(2.5), "2.5");
  setDecimals(2);
  assert.equal(showNumber(1.23456), "1.23");
  assert.equal(showNumber(1.23456, 4), "1.2346"); // a field that needs more keeps its own floor
  setDecimals(99);
  assert.equal(decimals(), 8);
  setDecimals(3);
});
