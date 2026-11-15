import test from "node:test";
import assert from "node:assert/strict";
import { bandParam, bandLabel, dragParam, isBandSlider } from "../src/bandslider.ts";

const info = { value: 20, scale: 1, min: 0.1, max: null, rest: 20 };

test("a band near the Auto length is Auto (0)", () => {
  assert.equal(bandParam(20.5, 20), 0);
  assert.equal(bandParam(25, 20), 25);
});

test("a drag starts from the shown length and sends the dragged length", () => {
  assert.equal(dragParam(info, 0), 0);
  assert.equal(dragParam(info, 10), 30);
  assert.equal(dragParam(info, -5), 15);
  assert.equal(dragParam(info, 0.4), 0);
});

test("labels read Auto at the Auto length", () => {
  assert.equal(bandLabel(20, 20, String), "Auto");
  assert.equal(bandLabel(30, 20, String), "30");
  assert.equal(isBandSlider({ rest: null }), false);
  assert.equal(isBandSlider({ rest: 5 }), true);
});

test("a handle without rest sends its plain value", () => {
  assert.equal(dragParam({ value: 5, scale: 2, min: null, max: null }, 3), 11);
});
