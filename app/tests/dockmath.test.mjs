import test from "node:test";
import assert from "node:assert/strict";
import { clampDockWidth, parseDockState, DOCK_MIN_PX, DOCK_MAX_PX, DOCK_DEFAULT_PX } from "../src/dockmath.ts";

test("the width stays between the minimum and the maximum", () => {
  assert.equal(clampDockWidth(10, 1920), DOCK_MIN_PX);
  assert.equal(clampDockWidth(2000, 3840), DOCK_MAX_PX);
  assert.equal(clampDockWidth(300, 1920), 300);
});

test("the panel never takes more than 45 percent of a narrow window, but never less than the minimum", () => {
  assert.equal(clampDockWidth(500, 800), 360);
  assert.equal(clampDockWidth(500, 300), DOCK_MIN_PX);
});

test("a width that is not a number gives the default", () => {
  assert.equal(clampDockWidth(NaN, 1920), DOCK_DEFAULT_PX);
});

test("the remembered state reads back, and bad text means open at the default width", () => {
  assert.deepEqual(parseDockState('{"hidden":true,"width":300}'), { hidden: true, width: 300 });
  assert.deepEqual(parseDockState(null), { hidden: false, width: DOCK_DEFAULT_PX });
  assert.deepEqual(parseDockState("{oops"), { hidden: false, width: DOCK_DEFAULT_PX });
});
