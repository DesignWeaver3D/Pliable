// Run with: node --test app/tests
import test from "node:test";
import assert from "node:assert/strict";
import { unpackDepth, viewDistance } from "../src/occlusion.ts";

test("depth 0 and 1 are the near and far planes", () => {
  assert.ok(Math.abs(viewDistance(0, 1, 100, false) - 1) < 1e-9);
  assert.ok(Math.abs(viewDistance(1, 1, 100, false) - 100) < 1e-9);
  assert.equal(viewDistance(0.5, 0, 10, true), 5);
});

test("a packed depth of 1 (all bytes 255) reads back as nearly 1, and zero bytes as 0", () => {
  assert.ok(Math.abs(unpackDepth(255, 255, 255, 255) - 1) < 0.005);
  assert.equal(unpackDepth(0, 0, 0, 0), 0);
});
