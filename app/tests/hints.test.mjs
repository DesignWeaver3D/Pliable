import test from "node:test";
import assert from "node:assert/strict";
import { MAX_HINTS, hintItems, loadPrefs, nextTip, savePrefs } from "../src/hints.ts";

const none = { ctrl: false, alt: false, shift: false };
const key = (id) => ({ "display.seeThrough": "X", "display.hide": "H", "view.lookAtFace": "V" })[id] ?? "";
const idle = { dragging: false, sketch: false, hasSelection: false };

test("a drag shows the measure pick key", () => {
  const items = hintItems({ ...idle, dragging: true }, none, key);
  assert.ok(items.some((i) => i.keys === "M" && /measure/.test(i.text)));
});

test("idle hints name see-through with the user's key and stay within the limit", () => {
  const items = hintItems({ ...idle, hasSelection: true }, none, (id) => (id === "display.seeThrough" ? "Ctrl+Alt+S" : key(id)));
  assert.equal(items[0].keys, "Ctrl+Alt+S");
  assert.ok(items.length <= MAX_HINTS);
});

test("held modifiers change the line", () => {
  assert.ok(hintItems(idle, { ...none, ctrl: true }, key).some((i) => /Ctrl\+click/.test(i.keys)));
  assert.ok(hintItems({ ...idle, hasSelection: true }, { ...none, shift: true }, key).some((i) => /isolate/.test(i.text)));
});

test("tips: measure during a drag, see-through at a selection, never after dismissal or when off", () => {
  const prefs = { on: true, dismissed: [] };
  assert.equal(nextTip({ ...idle, dragging: true }, prefs)?.id, "measure");
  assert.equal(nextTip({ ...idle, hasSelection: true }, prefs)?.id, "seethrough");
  assert.equal(nextTip(idle, prefs), null);
  assert.equal(nextTip({ ...idle, dragging: true }, { on: true, dismissed: ["measure"] }), null);
  assert.equal(nextTip({ ...idle, dragging: true }, { on: false, dismissed: [] }), null);
});

test("preferences round-trip and survive bad storage", () => {
  const store = {};
  const storage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
  savePrefs({ on: false, dismissed: ["measure"] }, storage);
  assert.deepEqual(loadPrefs(storage), { on: false, dismissed: ["measure"] });
  assert.deepEqual(loadPrefs({ getItem: () => "not json" }), { on: true, dismissed: [] });
  assert.deepEqual(loadPrefs(null), { on: true, dismissed: [] });
});
