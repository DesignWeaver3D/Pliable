import test from "node:test";
import assert from "node:assert/strict";
import { InteractionState } from "../src/interactionlogic.ts";

test("nothing is sent until the user chooses, and the core's value shows meanwhile", () => {
  const s = new InteractionState();
  assert.equal(s.sent(), null);
  assert.equal(s.effective("this"), "this");
  s.setReport({ value: "others", options: ["this", "others"] });
  assert.equal(s.effective("this"), "others");
  assert.equal(s.sent(), null);
  s.choose("this");
  assert.equal(s.effective("this"), "this");
  assert.equal(s.sent(), "this");
});

test("reset forgets the choice and announces it once", () => {
  const s = new InteractionState();
  let n = 0;
  s.subscribe(() => n++);
  s.reset();
  assert.equal(n, 0);
  s.choose("others");
  s.reset();
  assert.equal(n, 2);
  assert.equal(s.sent(), null);
});

test("the control hides without a tool default and when the core offers one option", () => {
  const s = new InteractionState();
  assert.equal(s.visible(null), false);
  assert.equal(s.visible(undefined), false);
  assert.equal(s.visible("this"), true);
  s.setReport({ value: "others", options: ["others"] });
  assert.equal(s.visible("this"), false);
  s.setReport({ value: "this", options: ["this", "others"] });
  assert.equal(s.visible("this"), true);
  s.setReport(undefined);
  assert.equal(s.report, null);
});

test("unsubscribe stops the callback", () => {
  const s = new InteractionState();
  let n = 0;
  const stop = s.subscribe(() => n++);
  stop();
  s.choose("this");
  assert.equal(n, 0);
});
