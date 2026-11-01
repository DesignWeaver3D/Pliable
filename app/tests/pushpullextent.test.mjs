import test from "node:test";
import assert from "node:assert/strict";
import { extentOn, extentParams, REACH_BUTTONS } from "../src/pushpullextent.ts";
import { PushPullState } from "../src/pushpullstate.ts";

test("no extent adds nothing and Up to face wins its fields", () => {
  assert.deepEqual(extentParams(null, null), {});
  assert.deepEqual(extentParams(0, null), { target: 0, symmetric: 0 });
  assert.deepEqual(extentParams(null, "last"), { extent: "last", symmetric: 0 });
  assert.deepEqual(extentParams(null, "through"), { extent: "through", symmetric: 0 });
  assert.equal(extentOn(null, null), false);
  assert.equal(extentOn(null, "through"), true);
  assert.equal(extentOn(3, null), true);
});

test("the extent buttons are Up to last and Through all", () => {
  assert.deepEqual(REACH_BUTTONS.map((b) => b.id), ["last", "through"]);
});

test("Up to last and Up to face replace each other and reset clears both", () => {
  const s = new PushPullState();
  s.setReach("last");
  assert.deepEqual(s.params(), { mode: "auto", flip: false, extent: "last", symmetric: 0 });
  s.setUpTo(5);
  assert.equal(s.reach, null);
  assert.deepEqual(s.params(), { mode: "auto", flip: false, target: 5, symmetric: 0 });
  s.setReach("through");
  assert.equal(s.upTo, null);
  s.reset();
  assert.equal(s.reach, null);
  assert.deepEqual(s.params(), { mode: "auto", flip: false });
});
