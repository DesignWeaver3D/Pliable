import test from "node:test";
import assert from "node:assert/strict";
import { isApple, keyNames } from "../src/platform.ts";

test("Apple platforms are told from the others", () => {
  for (const name of ["MacIntel", "macOS", "iPad"]) assert.equal(isApple(name), true);
  for (const name of ["Win32", "Windows", "Linux x86_64", ""]) assert.equal(isApple(name), false);
});

test("key names read Cmd and Option on a Mac and stay as written elsewhere", () => {
  assert.equal(keyNames("Ctrl+Z", true), "Cmd+Z");
  assert.equal(keyNames("Ctrl+Shift+Z", true), "Cmd+Shift+Z");
  assert.equal(keyNames("Alt+H", true), "Option+H");
  assert.equal(keyNames("needs Ctrl or Alt (Ctrl+click adds)", true), "needs Cmd or Option (Cmd+click adds)");
  assert.equal(keyNames("Alternate, Control", true), "Alternate, Control"); // whole words only
  assert.equal(keyNames("Ctrl+Z, Alt+H", false), "Ctrl+Z, Alt+H");
});
