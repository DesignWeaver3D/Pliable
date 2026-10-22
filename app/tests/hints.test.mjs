import test from "node:test";
import assert from "node:assert/strict";
import { hintItems, loadPrefs, nextTip, savePrefs } from "../src/hints.ts";

const none = { ctrl: false, alt: false, shift: false };
const key = (id) => ({ "display.seeThrough": "X", "display.hide": "H", "view.lookAtFace": "V" })[id] ?? "";
const idle = { dragging: false, sketch: false, hasSelection: false };

test("a drag shows the measure pick key", () => {
  const items = hintItems({ ...idle, dragging: true }, none, key);
  assert.ok(items.some((i) => i.keys === "M" && /measure/.test(i.text)));
});

test("idle shows no static legend", () => {
  assert.deepEqual(hintItems({ ...idle, hasSelection: true }, none, key), []);
  assert.deepEqual(hintItems(idle, none, key), []);
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

test("getting started lists six items and shows once while hints are on", async () => {
  const { gettingStartedItems, shouldAutoShowGettingStarted, GETTING_STARTED_ID } = await import("../src/hints.ts");
  const items = gettingStartedItems((id) => (id === "ui.shortcuts" ? "Shift+?" : ""));
  assert.equal(items.length, 6);
  assert.ok(items.some((i) => i.keys === "Ctrl+K") && items.some((i) => i.keys === "T") && items.some((i) => i.keys === "Shift+?"));
  assert.equal(shouldAutoShowGettingStarted({ on: true, dismissed: [] }), true);
  assert.equal(shouldAutoShowGettingStarted({ on: true, dismissed: [GETTING_STARTED_ID] }), false);
  assert.equal(shouldAutoShowGettingStarted({ on: false, dismissed: [] }), false);
});

test("the sketch key hint stays hidden once dismissed, in the sketch only", async () => {
  const { SKETCH_HINT_ID, sketchHintDismissed } = await import("../src/hints.ts");
  const sketching = { dragging: false, sketch: true, hasSelection: false };
  assert.ok(hintItems(sketching, none, key).length > 0);
  assert.equal(sketchHintDismissed(sketching, { dismissed: [] }), false);
  assert.equal(sketchHintDismissed(sketching, { dismissed: [SKETCH_HINT_ID] }), true);
  assert.equal(sketchHintDismissed(idle, { dismissed: [SKETCH_HINT_ID] }), false);
});
