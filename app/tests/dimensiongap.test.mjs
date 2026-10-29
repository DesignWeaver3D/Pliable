import test from "node:test";
import assert from "node:assert/strict";
import { gapSegment } from "../src/dimensiongap.ts";

const P = (x, y) => ({ x, y });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("a line through the value's rectangle is cut into two pieces either side of it", () => {
  const pieces = gapSegment(P(0, 0), P(100, 0), P(50, 0), 10, 6, 0);
  assert.equal(pieces.length, 2);
  near(pieces[0][1].x, 40);
  near(pieces[1][0].x, 60);
  near(pieces[0][0].x, 0);
  near(pieces[1][1].x, 100);
});

test("a line that misses the rectangle, or only runs beside it, is left whole", () => {
  const a = P(0, 20);
  const b = P(100, 20);
  assert.deepEqual(gapSegment(a, b, P(50, 0), 10, 6, 0), [[a, b]]);
  const c = P(0, 40);
  assert.deepEqual(gapSegment(c, P(30, 40), P(50, 0), 10, 6, 0), [[c, P(30, 40)]]);
});

test("a line ending inside the rectangle (a leader landing on its value) keeps only the part outside", () => {
  const pieces = gapSegment(P(0, 0), P(50, 0), P(50, 0), 10, 6, 0);
  assert.equal(pieces.length, 1);
  near(pieces[0][1].x, 40);
});

test("the rectangle turns with the text: a slanted line is cut where it crosses the turned box", () => {
  // text turned 90 degrees: the box is 12 wide and 20 tall in screen terms
  const pieces = gapSegment(P(0, 0), P(100, 0), P(50, 0), 10, 6, 90);
  near(pieces[0][1].x, 44);
  near(pieces[1][0].x, 56);
  // a vertical line at the center through a text turned 90 degrees is cut over the full text width
  const vertical = gapSegment(P(50, -50), P(50, 50), P(50, 0), 10, 6, 90);
  near(vertical[0][1].y, -10);
  near(vertical[1][0].y, 10);
});

test("a sliver left over by the cut is dropped", () => {
  const pieces = gapSegment(P(39.5, 0), P(100, 0), P(50, 0), 10, 6, 0);
  assert.equal(pieces.length, 1);
  near(pieces[0][0].x, 60);
});
