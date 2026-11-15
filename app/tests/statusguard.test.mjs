import test from "node:test";
import assert from "node:assert/strict";
import { judge, kindOf } from "../src/statusguard.ts";

const msg = (text, kind, className = "") => ({ text, kind, className });

test("a message is an error by its class and a warning by its class or its text", () => {
  assert.equal(kindOf("x", true, false), "error");
  assert.equal(kindOf("x", false, true), "warning");
  assert.equal(kindOf("Warning: thin wall", false, false), "warning");
  assert.equal(kindOf("bracket: 19 faces", false, false), "info");
});

test("an unread error is put back over a plain message", () => {
  const first = judge(null, msg("Nothing to subtract", "error", "error"));
  assert.equal(first.restore, false);
  const next = judge(first.held, msg("face 3", "info"));
  assert.equal(next.restore, true);
  assert.equal(next.held.text, "Nothing to subtract");
});

test("a new error or warning replaces the held one", () => {
  const first = judge(null, msg("one", "error", "error"));
  const next = judge(first.held, msg("Warning: two", "warning"));
  assert.equal(next.restore, false);
  assert.equal(next.held.text, "Warning: two");
  assert.equal(next.held.read, false);
});

test("once it has been read, a plain message replaces it and nothing is held", () => {
  const first = judge(null, msg("one", "error", "error"));
  first.held.read = true;
  const next = judge(first.held, msg("face 3", "info"));
  assert.equal(next.restore, false);
  assert.equal(next.held, null);
});

test("seeing the held message again does not make it unread", () => {
  const first = judge(null, msg("one", "error", "error"));
  first.held.read = true;
  assert.equal(judge(first.held, msg("one", "error", "error")).held.read, true);
});

test("plain messages with nothing held pass through", () => {
  assert.deepEqual(judge(null, msg("hello", "info")), { held: null, restore: false });
});
