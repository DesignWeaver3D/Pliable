import test from "node:test";
import assert from "node:assert/strict";
import { loadSketchOptions } from "../src/sketchoptions.ts";

test("automatic sketch constraints are on (snaps and shapes) when nothing is saved", () => {
  assert.equal(loadSketchOptions().auto, "shape");
});

test("a saved automatic-constraints choice still wins", () => {
  globalThis.localStorage = { getItem: () => JSON.stringify({ auto: "none" }) };
  try {
    assert.equal(loadSketchOptions().auto, "none");
  } finally {
    delete globalThis.localStorage;
  }
});
