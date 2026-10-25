import test from "node:test";
import assert from "node:assert/strict";
import { shortcutSheetHtml } from "../src/shortcutsheet.ts";

test("the sheet lists every command with its key and escapes markup", () => {
  const html = shortcutSheetHtml([{ label: "Undo", keys: "Ctrl+Z" }, { label: "Show <all> & more", keys: "" }]);
  assert.match(html, /<td>Undo<\/td><td><code>Ctrl\+Z<\/code><\/td>/);
  assert.match(html, /Show &lt;all&gt; &amp; more/);
  assert.match(html, /<code>none<\/code>/);
  assert.doesNotMatch(html, /<script/);
});
