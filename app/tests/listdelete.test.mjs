import test from "node:test";
import assert from "node:assert/strict";
import { deleteAction, isTyping } from "../src/listdelete.ts";

const ctx = (over = {}) => ({ bodies: [], row: null, typing: false, blocked: false, ...over });

test("Delete removes the selected bodies together", () => {
  assert.deepEqual(deleteAction("Delete", ctx({ bodies: [2, 5] })), { kind: "bodies", ids: [2, 5] });
});

test("Delete removes the clicked sketch or datum row", () => {
  const row = { list: "sketch", id: 3 };
  assert.deepEqual(deleteAction("Delete", ctx({ row })), { kind: "row", row });
});

test("Delete does nothing while typing, blocked or with nothing selected", () => {
  assert.equal(deleteAction("Delete", ctx({ bodies: [1], typing: true })), null);
  assert.equal(deleteAction("Delete", ctx({ bodies: [1], blocked: true })), null);
  assert.equal(deleteAction("Delete", ctx()), null);
  assert.equal(deleteAction("x", ctx({ bodies: [1] })), null);
});

test("isTyping spots text fields", () => {
  assert.equal(isTyping({ tagName: "INPUT" }), true);
  assert.equal(isTyping({ tagName: "DIV", isContentEditable: false }), false);
  assert.equal(isTyping(null), false);
});
