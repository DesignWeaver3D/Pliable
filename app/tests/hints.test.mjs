import test from "node:test";
import assert from "node:assert/strict";
import { hintItems, loadPrefs, nextTip, savePrefs, stickyTip } from "../src/hints.ts";

const none = { ctrl: false, alt: false, shift: false };
const key = (id) => ({ "display.seeThrough": "X", "display.hide": "H", "view.lookAtFace": "V" })[id] ?? "";
const idle = { dragging: false, sketch: false, hasSelection: false };


test("idle shows no static legend", () => {
  assert.deepEqual(hintItems({ ...idle, hasSelection: true }, none, key), []);
  assert.deepEqual(hintItems(idle, none, key), []);
});

test("held modifiers change the line", () => {
  assert.ok(hintItems(idle, { ...none, ctrl: true }, key).some((i) => /Ctrl\+click/.test(i.keys)));
  assert.ok(hintItems({ ...idle, hasSelection: true }, { ...none, shift: true }, key).some((i) => /isolate/.test(i.text)));
  assert.ok(hintItems({ ...idle, hasSelection: true }, { ...none, shift: true }, key).some((i) => /add it to the selection/.test(i.text)));
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
  assert.ok(items.some((i) => i.keys === "/") && items.some((i) => i.keys === "T") && items.some((i) => i.keys === "Shift+?"));
  assert.equal(shouldAutoShowGettingStarted({ on: true, dismissed: [] }), true);
  assert.equal(shouldAutoShowGettingStarted({ on: true, dismissed: [GETTING_STARTED_ID] }), false);
  assert.equal(shouldAutoShowGettingStarted({ on: false, dismissed: [] }), false);
});


test("each sketch plane button names the axes along its bottom and left edges", async () => {
  const { SKETCH_PLANES, SKETCH_PLANE_AXES } = await import("../src/layout.ts");
  assert.deepEqual(SKETCH_PLANES.map((p) => [SKETCH_PLANE_AXES[p].bottom, SKETCH_PLANE_AXES[p].left]), [["x", "y"], ["x", "z"], ["y", "z"]]);
});

test("a drag hint line has no measure item (the tip covers it) and the sketch has no key hint line", () => {
  assert.ok(!hintItems({ ...idle, dragging: true }, none, key).some((i) => /measure/.test(i.text)));
  assert.deepEqual(hintItems({ ...idle, sketch: true }, none, key), []);
});

test("a tip stays after its context ends, until it is dismissed or hints go off", () => {
  const prefs = { on: true, dismissed: [] };
  const tip = nextTip({ ...idle, dragging: true }, prefs);
  assert.equal(stickyTip(tip, idle, prefs)?.id, "measure");
  assert.equal(stickyTip(tip, idle, { on: true, dismissed: ["measure"] }), null);
  assert.equal(stickyTip(tip, idle, { on: false, dismissed: [] }), null);
  assert.equal(stickyTip(tip, { ...idle, sketch: true }, prefs), null);
  assert.equal(stickyTip(null, { ...idle, hasSelection: true }, prefs)?.id, "seethrough");
});
