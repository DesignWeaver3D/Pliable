import test from "node:test";
import assert from "node:assert/strict";
import { recentMessages, recordMessage } from "../src/messagelog.ts";

test("messages are kept oldest first, repeats are dropped and only the newest 50 stay", () => {
  recordMessage("Malformed sketch: first", "error");
  recordMessage("Malformed sketch: first", "error");
  recordMessage("second", "warning");
  const kept = recentMessages();
  assert.equal(kept.length, 2);
  assert.match(kept[0], /error: Malformed sketch: first$/);
  assert.match(kept[1], /warning: second$/);
  for (let i = 0; i < 60; i++) recordMessage(`m${i}`, "error");
  assert.equal(recentMessages().length, 50);
  assert.match(recentMessages()[49], /m59$/);
});
