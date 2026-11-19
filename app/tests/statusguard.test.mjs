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

// A stand-in for the status line element and for MutationObserver, enough to run the guard beside another observer.
function fakeStatusLine() {
  const watchers = [];
  const notify = (kind) => watchers.forEach((w) => { if (w.opts[kind]) w.pending = true; });
  let text = "";
  let classes = "";
  const el = {
    get textContent() { return text; },
    set textContent(value) { text = String(value); notify("childList"); },
    get className() { return classes; },
    set className(value) { classes = String(value); notify("attributes"); },
    classList: {
      contains: (name) => classes.split(/\s+/).includes(name),
      toggle(name, on) {
        const has = this.contains(name);
        if (on === has) return;
        el.className = on ? `${classes} ${name}`.trim() : classes.split(/\s+/).filter((c) => c !== name).join(" ");
      },
      remove(name) { this.toggle(name, false); },
    },
    addEventListener() {},
  };
  class Observer {
    constructor(callback) { this.callback = callback; }
    observe(_el, opts) { watchers.push({ opts, pending: false, callback: this.callback }); }
  }
  /** Deliver pending changes until nothing is pending; a loop that never settles throws. */
  const settle = () => {
    for (let round = 0; round < 50; round++) {
      const due = watchers.filter((w) => w.pending);
      if (!due.length) return;
      due.forEach((w) => { w.pending = false; w.callback(); });
    }
    throw new Error("the observers never settle");
  };
  return { el, Observer, settle };
}

test("an unread sketch warning followed by a plain sketch message settles and stays shown", async () => {
  const { el, Observer, settle } = fakeStatusLine();
  globalThis.MutationObserver = Observer;
  globalThis.window = globalThis;
  const { installStatusGuard } = await import("../src/statusguard.ts");
  // The rule in main.ts: the orange style stays only while the text it was set for is showing.
  let warnedText = null;
  new Observer(() => {
    if (el.classList.contains("warn") && el.textContent !== warnedText) el.classList.remove("warn");
  }).observe(el, { childList: true, characterData: true, subtree: true });
  installStatusGuard(el, { keepInfo: () => true });
  const sketchStatus = (text, error = false) => {
    el.textContent = text;
    el.classList.toggle("error", error === true);
    el.classList.toggle("warn", error === "warn");
    warnedText = error === "warn" ? text : null;
  };
  sketchStatus("Select geometry to dimension", "warn");
  settle();
  sketchStatus("Sketch kept");
  settle();
  assert.equal(el.textContent, "Select geometry to dimension");
  assert.ok(el.classList.contains("warn"));
});
