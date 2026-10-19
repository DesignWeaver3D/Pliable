import test from "node:test";
import assert from "node:assert/strict";
import { settings, updateSettings } from "../src/settings.ts";

test("see-through opacity defaults to 12 percent and updates live", () => {
  assert.equal(settings.seeThroughOpacity, 12);
  let calls = 0;
  updateSettings({ seeThroughOpacity: 30 });
  assert.equal(settings.seeThroughOpacity, 30);
  assert.equal(calls, 0);
});
