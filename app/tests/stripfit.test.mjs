import test from "node:test";
import assert from "node:assert/strict";
import { fitStripCount, stripAvailable } from "../src/stripfit.ts";

const w = (tools, over = {}) => ({ tools, helpers: 0, more: 80, gap: 6, chrome: 14, ...over });

test("as many tools as fit are shown, with no fixed count", () => {
  const tools = Array(20).fill(90);
  assert.equal(fitStripCount(w(tools), 14 + 80 + 3 * 96), 3);
  assert.equal(fitStripCount(w(tools), 14 + 80 + 12 * 96), 12);
  assert.equal(fitStripCount(w(tools), 5000), 20);
});

test("helpers keep their room and shrink the tool count", () => {
  const tools = Array(20).fill(90);
  assert.equal(fitStripCount(w(tools, { helpers: 100 }), 14 + 80 + 106 + 4 * 96), 4);
});

test("one tool stays even in a narrow strip, and none gives zero", () => {
  assert.equal(fitStripCount(w([90, 90]), 50), 1);
  assert.equal(fitStripCount(w([]), 500), 0);
});

test("the available width leaves the larger side free on both sides", () => {
  assert.equal(stripAvailable(1400, 240, 200), 920);
  assert.equal(stripAvailable(1400, 100, 300), 800);
  assert.equal(stripAvailable(300, 240, 240), 120);
});
