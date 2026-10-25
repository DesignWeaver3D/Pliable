import test from "node:test";
import assert from "node:assert/strict";
import { pruneGhost, toggleFocus, toggleGhost } from "../src/bodylogic.ts";
import { ghostRuns } from "../src/visibility.ts";

const all = [1, 2, 3];
const list = (s) => [...s].sort();

test("the X toggles one body between solid and see-through", () => {
  assert.deepEqual(list(toggleGhost(new Set(), 2)), [2]);
  assert.deepEqual(list(toggleGhost(new Set([2]), 2)), []);
});

test("focus on a body ghosts every other body", () => {
  const r = toggleFocus(new Set(), null, all, 1);
  assert.deepEqual(list(r.ghost), [2, 3]);
  assert.equal(r.focus.body, 1);
});

test("focus again restores", () => {
  const on = toggleFocus(new Set(), null, all, 1);
  const off = toggleFocus(on.ghost, on.focus, all, 1);
  assert.deepEqual(list(off.ghost), []);
  assert.equal(off.focus, null);
});

test("a body ghosted by hand stays ghosted when focus is turned off", () => {
  const on = toggleFocus(new Set([2]), null, all, 1);
  assert.deepEqual(list(on.ghost), [2, 3]);
  const off = toggleFocus(on.ghost, on.focus, all, 1);
  assert.deepEqual(list(off.ghost), [2]);
});

test("ghosting by hand during focus survives the end of focus", () => {
  const on = toggleFocus(new Set(), null, all, 1);
  const off = toggleFocus(toggleGhost(on.ghost, 1), on.focus, all, 1);
  assert.deepEqual(list(off.ghost), [1]);
});

test("focus on another body moves the focus", () => {
  const on = toggleFocus(new Set([3]), null, all, 1);
  const moved = toggleFocus(on.ghost, on.focus, all, 2);
  assert.deepEqual(list(moved.ghost), [1, 3]);
  const off = toggleFocus(moved.ghost, moved.focus, all, 2);
  assert.deepEqual(list(off.ghost), [3]);
});

test("a focused body that was ghosted by hand becomes solid", () => {
  const on = toggleFocus(new Set([1]), null, all, 1);
  assert.deepEqual(list(on.ghost), [2, 3]);
});

test("removed bodies are pruned and focus ends with its body", () => {
  const on = toggleFocus(new Set(), null, all, 1);
  const p = pruneGhost(on.ghost, on.focus, [1, 2]);
  assert.deepEqual(list(p.ghost), [2]);
  assert.equal(p.focus.body, 1);
  const q = pruneGhost(on.ghost, on.focus, [2, 3]);
  assert.equal(q.focus, null);
  assert.deepEqual(list(q.ghost), [2, 3]);
});

test("draw ranges merge into solid and see-through runs", () => {
  const faces = [
    { start: 0, count: 6, body: 1 },
    { start: 6, count: 6, body: 2 },
    { start: 12, count: 6, body: 2 },
    { start: 18, count: 6, body: 1 },
  ];
  assert.deepEqual(ghostRuns(faces, new Set([2]), 24), [
    { start: 0, count: 6, ghost: false },
    { start: 6, count: 12, ghost: true },
    { start: 18, count: 6, ghost: false },
  ]);
  assert.deepEqual(ghostRuns(faces, new Set(), 24), [{ start: 0, count: 24, ghost: false }]);
});
