import test from "node:test";
import assert from "node:assert/strict";
import { createDrawPacing, wakeOnActivity } from "../src/drawpacing.ts";

test("the view draws at the start, then rests", () => {
  const pacing = createDrawPacing(1000);
  assert.equal(pacing.draws(0), true);
  assert.equal(pacing.draws(999), true);
  assert.equal(pacing.draws(1000), false);
  assert.equal(pacing.draws(60000), false);
});

test("a wake draws again for the rest time, counted from the last wake", () => {
  const pacing = createDrawPacing(1000);
  pacing.draws(0);
  assert.equal(pacing.draws(5000), false);
  pacing.wake();
  assert.equal(pacing.draws(5016), true);
  pacing.wake();
  assert.equal(pacing.draws(5900), true);
  assert.equal(pacing.draws(6890), true);
  assert.equal(pacing.draws(6900), false);
});

test("a wake followed by long work still gets its frames", () => {
  const pacing = createDrawPacing(1000);
  pacing.draws(0);
  pacing.wake(); // at time 100, then the page is busy for three seconds
  assert.equal(pacing.draws(3100), true);
  assert.equal(pacing.draws(4000), true);
  assert.equal(pacing.draws(4100), false);
});

test("user actions wake the view", () => {
  const listeners = new Map();
  const target = { addEventListener: (type, fn) => listeners.set(type, fn) };
  const pacing = createDrawPacing(1000);
  wakeOnActivity(pacing, target);
  pacing.draws(0);
  let time = 10000;
  for (const type of ["pointermove", "pointerdown", "wheel", "keydown", "resize"]) {
    assert.equal(pacing.draws(time), false);
    listeners.get(type)();
    assert.equal(pacing.draws(time), true);
    time += 5000;
  }
});
