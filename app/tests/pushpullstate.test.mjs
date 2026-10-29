import test from "node:test";
import assert from "node:assert/strict";
import { PushPullState, MODE_BUTTONS, arrowRoles } from "../src/pushpullstate.ts";

test("the mode starts at Auto, choosing a button leaves Auto", () => {
  const s = new PushPullState();
  assert.equal(s.mode, "auto");
  s.setChoice("subtract");
  assert.equal(s.mode, "subtract");
  assert.deepEqual(MODE_BUTTONS.map((m) => m.id), ["auto", "add", "subtract", "new"]);
});

test("Alt makes it New body while held and the choice comes back on release", () => {
  const s = new PushPullState();
  s.setChoice("add");
  s.setAlt(true);
  assert.equal(s.mode, "new");
  assert.equal(s.choice, "add");
  s.setAlt(false);
  assert.equal(s.mode, "add");
});

test("a change is announced once, an unchanged Alt is not", () => {
  const s = new PushPullState();
  let n = 0;
  s.onChange = () => n++;
  s.setAlt(true);
  s.setAlt(true);
  s.setFlip(true);
  assert.equal(n, 2);
});

test("the request fields carry the mode in force and the flip", () => {
  const s = new PushPullState();
  s.setFlip(true);
  assert.deepEqual(s.params(), { mode: "auto", flip: true });
  s.setAlt(true);
  assert.deepEqual(s.params(), { mode: "new", flip: true });
});

test("Flip swaps which arrow adds", () => {
  assert.deepEqual(arrowRoles(false), { normalSide: "add", oppositeSide: "subtract" });
  assert.deepEqual(arrowRoles(true), { normalSide: "subtract", oppositeSide: "add" });
});
