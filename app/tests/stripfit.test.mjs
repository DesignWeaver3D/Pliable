import test from "node:test";
import assert from "node:assert/strict";
import { fitStripCount, stripRoom } from "../src/stripfit.ts";

const w = (tools, over = {}) => ({ tools, helpers: [], more: 80, gap: 6, chrome: 14, ...over });

test("everything is shown, with no More button, while it fits in two rows", () => {
  const tools = Array(10).fill(90); // 96 per button with its gap
  assert.equal(fitStripCount(w(tools), 14 + 5 * 96), 10); // five per row, two full rows
  assert.equal(fitStripCount(w(tools), 5000), 10);
});

test("past two rows the list is cut so that the More button fits in the second row", () => {
  const tools = Array(12).fill(90);
  const limit = 5 * 96 - 6; // five buttons per row
  const count = fitStripCount(w(tools), 14 + limit);
  assert.ok(count < 12 && count >= 5);
  assert.equal(count, 9); // 5 + 4 buttons, then More (80) still fits beside them
});

test("helpers keep their room, and one tool stays even in a very narrow strip", () => {
  const tools = Array(12).fill(90);
  const wide = fitStripCount(w(tools, { helpers: [100] }), 14 + 5 * 96 - 6);
  assert.ok(wide < fitStripCount(w(tools), 14 + 5 * 96 - 6));
  assert.equal(fitStripCount(w([90, 90, 90]), 50), 1);
  assert.equal(fitStripCount(w([]), 500), 0);
});

test("the strip is centered in the room between the left and right sides", () => {
  assert.deepEqual(stripRoom(1400, 240, 200), { width: 960, centre: 720 });
  assert.deepEqual(stripRoom(1400, 540, 160), { width: 700, centre: 890 });
  assert.equal(stripRoom(300, 240, 240).width, 120);
});
