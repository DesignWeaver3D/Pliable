// Run with: node --test app/tests   (Node 24 runs the TypeScript source directly)
import test from "node:test";
import assert from "node:assert/strict";
import { ENGAGE_GRACE_MS, Engagement, KEY_COMMANDS, Keymap, checkKeymap, chordMatches, decideKey, formatChord, parseChord, validateBinding } from "../src/keys.ts";

const ev = (key, extra = {}) => ({ key, code: extra.code ?? (key.length === 1 && /\d/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`), ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra });
const live = { pageFocused: true, inTextField: false, entryActive: false, engaged: true, sketchActive: false };
const keymap = () => new Keymap();
const ran = (e, ctx = live, km = keymap()) => decideKey(e, ctx, km).run?.id ?? null;
const why = (e, ctx, km = keymap()) => decideKey(e, ctx, km).reason;

test("default keymap is sound: parseable, valid, no duplicate chords", () => {
  const defaults = Object.fromEntries(KEY_COMMANDS.map((c) => [c.id, c.defaults]));
  assert.deepEqual(checkKeymap(KEY_COMMANDS, defaults), []);
});

test("a duplicate binding is reported", () => {
  const bad = { "view.top": ["P"], "view.projection": ["P"] };
  assert.ok(checkKeymap(KEY_COMMANDS, bad).some((p) => p.includes("bound to both")));
});

test("view digits match the physical key, with or without shift", () => {
  assert.equal(ran(ev("2")), "view.top");
  assert.equal(ran(ev("&", { code: "Digit2", shiftKey: true })), "view.top"); // AZERTY top row
  assert.equal(ran(ev("2", { code: "Numpad2" })), "view.top");
});

test("letters match the printed character", () => {
  assert.equal(ran(ev("p")), "view.projection");
  assert.equal(ran(ev("P", { shiftKey: false })), "view.projection");
  assert.equal(ran(ev("h")), "display.hide");
  assert.equal(ran(ev("H", { shiftKey: true })), "display.isolate");
  assert.equal(ran(ev("h", { altKey: true })), "display.showAll");
});

test("undo and redo need Ctrl; bare z does nothing", () => {
  assert.equal(ran(ev("z", { ctrlKey: true })), "history.undo");
  assert.equal(ran(ev("z", { metaKey: true })), "history.undo");
  assert.equal(ran(ev("y", { ctrlKey: true })), "history.redo");
  assert.equal(ran(ev("Z", { ctrlKey: true, shiftKey: true })), "history.redo");
  assert.equal(ran(ev("z")), null);
});

test("text fields, composing input and an unfocused page swallow everything", () => {
  assert.equal(why(ev("p"), { ...live, inTextField: true }), "text");
  assert.equal(why(ev("z", { ctrlKey: true }), { ...live, inTextField: true }), "text");
  assert.equal(why(ev("p", { isComposing: true }), live), "composing");
  assert.equal(why(ev("Process", { keyCode: 229 }), live), "composing");
  assert.equal(why(ev("p"), { ...live, pageFocused: false }), "page");
});

test("bare keys need an engaged viewport, modified keys do not", () => {
  const off = { ...live, engaged: false };
  assert.equal(why(ev("p"), off), "disengaged");
  assert.equal(why(ev("h"), off), "disengaged");
  assert.equal(ran(ev("z", { ctrlKey: true }), off), "history.undo");
  assert.equal(ran(ev("h", { altKey: true }), off), "display.showAll");
});

test("value entry owns the keyboard, including undo", () => {
  const typing = { ...live, entryActive: true };
  assert.equal(why(ev("2"), typing), "entry");
  assert.equal(why(ev("z", { ctrlKey: true }), typing), "entry");
});

test("held keys fire once, except where repeat is allowed", () => {
  assert.equal(why(ev("p", { repeat: true }), live), "repeat");
  assert.equal(ran(ev("z", { ctrlKey: true, repeat: true })), "history.undo");
});

test("sketch mode swaps undo and hide for the sketch's own keys and keeps view keys", () => {
  const sketching = { ...live, sketchActive: true };
  assert.equal(ran(ev("z", { ctrlKey: true }), sketching), "sketch.undo");
  assert.equal(ran(ev("z", { ctrlKey: true })), "history.undo");
  assert.equal(ran(ev("h"), sketching), null);
  assert.equal(ran(ev("1"), sketching), "view.front");
  assert.equal(ran(ev("Delete", { code: "Delete" }), sketching), "sketch.delete");
  assert.equal(ran(ev("Backspace", { code: "Backspace" }), sketching), "sketch.delete");
  assert.equal(ran(ev("Delete", { code: "Delete" })), null); // not in a sketch
  assert.equal(ran(ev("Enter", { code: "Enter" }), sketching), "sketch.finish");
});

test("sketch keys obey the guards: text fields, engagement, repeat; Escape needs no engagement", () => {
  const sketching = { ...live, sketchActive: true };
  const off = { ...sketching, engaged: false };
  assert.equal(why(ev("Delete", { code: "Delete" }), { ...sketching, inTextField: true }), "text");
  assert.equal(why(ev("Delete", { code: "Delete" }), off), "disengaged");
  assert.equal(why(ev("Delete", { code: "Delete", repeat: true }), sketching), "repeat");
  assert.equal(ran(ev("Escape", { code: "Escape" }), off), "sketch.cancel");
  const noSingle = new Keymap(KEY_COMMANDS, { version: 1, singleKeys: false, bindings: {} });
  assert.equal(ran(ev("Delete", { code: "Delete" }), sketching, noSingle), "sketch.delete"); // editing keys, not shortcuts
});

test("sketch keys are fixed and may share Ctrl+Z with the app undo", () => {
  const undo = KEY_COMMANDS.find((c) => c.id === "history.undo");
  const sk = KEY_COMMANDS.find((c) => c.id === "sketch.undo");
  assert.equal(validateBinding(sk, "Ctrl+K", {}).ok, false);
  const km = new Keymap();
  assert.equal(validateBinding(undo, "Ctrl+Z", km.all()).ok, true); // its own key
  const top = KEY_COMMANDS.find((c) => c.id === "view.top");
  assert.equal(validateBinding(top, "Ctrl+Z", km.all()).ok, false); // clashes with the app undo
});

test("the single-key switch turns off bare keys only", () => {
  const km = new Keymap(KEY_COMMANDS, { version: 1, singleKeys: false, bindings: {} });
  assert.equal(why(ev("p"), live, km), "off");
  assert.equal(ran(ev("z", { ctrlKey: true }), live, km), "history.undo");
});

test("sequences and bad chords are rejected", () => {
  const view = KEY_COMMANDS.find((c) => c.id === "view.top");
  for (const text of ["G then H", "G H", "Ctrl+", "Shift", "Ctrl+Shift", "", "Ctrl+G+H", "Foo+G"]) {
    assert.equal(validateBinding(view, text, {}).ok, false, text);
  }
});

test("browser-reserved and app-reserved keys are rejected", () => {
  const view = KEY_COMMANDS.find((c) => c.id === "view.top");
  for (const text of ["Ctrl+W", "Ctrl+T", "Ctrl+Shift+N", "F5", "Alt+ArrowLeft", "Escape", "Enter", "Tab"]) {
    assert.equal(validateBinding(view, text, {}).ok, false, text);
  }
});

test("any combination of Ctrl, Alt and Shift is a valid modifier set", () => {
  const model = { id: "x.m", label: "M", class: "model", defaults: [] };
  const view = KEY_COMMANDS.find((c) => c.id === "view.top");
  for (const text of ["Ctrl+Alt+E", "Ctrl+Alt+Shift+E", "Alt+Shift+E", "Ctrl+Shift+E", "Alt+E", "Shift+E"]) {
    assert.equal(validateBinding(view, text, {}).ok, true, text);
    assert.equal(formatChord(parseChord(text)), text);
  }
  assert.equal(validateBinding(model, "Ctrl+Alt+E", {}).ok, true);
  assert.equal(validateBinding(model, "Alt+Shift+E", {}).ok, true);
  assert.equal(validateBinding(model, "Shift+E", {}).ok, false);
  const chord = parseChord("Ctrl+Alt+Shift+E");
  assert.ok(chordMatches(chord, { key: "E", code: "KeyE", ctrlKey: true, metaKey: false, altKey: true, shiftKey: true }));
  assert.ok(!chordMatches(chord, { key: "E", code: "KeyE", ctrlKey: true, metaKey: false, altKey: false, shiftKey: true }));
});

test("model and setting commands cannot take a bare key; view and arm commands can", () => {
  const model = { id: "x.delete", label: "Delete", class: "model", defaults: [] };
  const setting = { id: "x.units", label: "Units", class: "setting", defaults: [] };
  const arm = { id: "x.arm", label: "Arm", class: "arm", defaults: [] };
  assert.equal(validateBinding(model, "X", {}).ok, false);
  assert.equal(validateBinding(setting, "Shift+U", {}).ok, false);
  assert.equal(validateBinding(model, "Ctrl+Shift+X", {}).ok, true);
  assert.equal(validateBinding(model, "Alt+X", {}).ok, true);
  assert.equal(validateBinding(arm, "X", {}).ok, true);
});

test("a conflicting assignment names the owner", () => {
  const top = KEY_COMMANDS.find((c) => c.id === "view.top");
  const result = validateBinding(top, "P", new Keymap().all());
  assert.equal(result.ok, false);
  assert.equal(result.conflict, "view.projection");
});

test("user rebinding takes effect and the old key stops working", () => {
  const km = new Keymap();
  km.assign("view.projection", ["O"]);
  assert.equal(ran(ev("o"), live, km), "view.projection");
  assert.equal(ran(ev("p"), live, km), null);
  km.reset("view.projection");
  assert.equal(ran(ev("p"), live, km), "view.projection");
});

test("saved keymaps drop invalid or conflicting entries", () => {
  const km = Keymap.fromJson({
    version: 1,
    singleKeys: true,
    bindings: { "view.top": ["P"], "view.front": ["Ctrl+W"], "view.left": ["G H"], nonsense: ["Q"], "view.rear": ["K"] },
  });
  assert.deepEqual(km.chordsOf("view.top"), ["Digit2", "Numpad2"]); // conflicts with P
  assert.deepEqual(km.chordsOf("view.front"), ["Digit1", "Numpad1"]); // reserved
  assert.deepEqual(km.chordsOf("view.left"), ["Digit6", "Numpad6"]); // sequence
  assert.deepEqual(km.chordsOf("view.rear"), ["K"]);
  assert.equal(Keymap.fromJson("garbage").data.singleKeys, true);
});

test("hints show the first non-numpad chord", () => {
  const km = new Keymap();
  assert.equal(km.hint("view.top"), "2");
  assert.equal(km.hint("display.isolate"), "Shift+H");
  assert.equal(km.hint("history.undo"), "Ctrl+Z");
});

test("engagement: pointer, grace period, click and blur", () => {
  const eng = new Engagement();
  assert.equal(eng.active(0), false);
  eng.pointerEnter();
  assert.equal(eng.active(0), true);
  eng.pointerLeave(1000);
  assert.equal(eng.active(1000 + ENGAGE_GRACE_MS - 1), true);
  assert.equal(eng.active(1000 + ENGAGE_GRACE_MS + 1), false);
  eng.click();
  eng.pointerLeave(5000);
  assert.equal(eng.active(99999), true); // a click holds engagement
  eng.blur();
  assert.equal(eng.active(5001), false); // window blur drops it at once, no grace
  eng.click();
  eng.release(); // clicking elsewhere or opening a dialog
  assert.equal(eng.active(0), false);
});
