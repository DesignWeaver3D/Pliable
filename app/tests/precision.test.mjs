import test from "node:test";
import assert from "node:assert/strict";
import { setDecimals, showNumber, decimals, roundValue } from "../src/precision.ts";
import { formatValue, linkedValues } from "../src/handlemath.ts";
import { pointText } from "../src/placepick.ts";

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

test("drag rounding, handle labels and point labels follow the chosen decimals", () => {
  setDecimals(3);
  assert.equal(roundValue(1.23456), 1.235);
  assert.equal(formatValue(1.23456), "1.235");
  assert.equal(pointText([1.23456, 2, 3.5]), "1.235, 2, 3.5");
  setDecimals(6);
  assert.equal(roundValue(1.23456789), 1.234568);
  assert.equal(formatValue(1.23456789), "1.234568");
  assert.deepEqual(linkedValues({ links: [{ param: "d", value: 1, scale: 1 }] }, 0.1234567), { d: 1.123457 });
  setDecimals(1);
  assert.equal(roundValue(1.26), 1.3);
  assert.equal(roundValue(-0.01), 0);
  setDecimals(3);
});
