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

test("on a Mac the Backspace key deletes too; elsewhere it does nothing", async () => {
  const { isApple } = await import("../src/platform.ts");
  const row = { list: "sketch", id: 3 };
  const base = { bodies: [2], row: null, typing: false, blocked: false };
  assert.equal(deleteAction("Backspace", base), null);
  assert.deepEqual(deleteAction("Backspace", base, true), { kind: "bodies", ids: [2] });
  assert.deepEqual(deleteAction("Backspace", { ...base, row }, true), { kind: "row", row });
  assert.equal(deleteAction("Backspace", { ...base, typing: true }, true), null);
  assert.deepEqual(deleteAction("Delete", base, true), { kind: "bodies", ids: [2] });
  assert.equal(isApple("MacIntel"), true);
  assert.equal(isApple("macOS"), true);
  assert.equal(isApple("Win32"), false);
  assert.equal(isApple("Linux x86_64"), false);
  assert.equal(isApple(""), false);
});
