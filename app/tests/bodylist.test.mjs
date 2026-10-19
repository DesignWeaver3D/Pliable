import test from "node:test";
import assert from "node:assert/strict";
import { doubleClickBody, clickRows, isIsolated, pruneHidden, toggleHidden, toggleIsolated } from "../src/bodylogic.ts";
import { filterHidden } from "../src/visibility.ts";

test("the eye toggles one body", () => {
  assert.deepEqual([...toggleHidden(new Set(), 2)], [2]);
  assert.deepEqual([...toggleHidden(new Set([2]), 2)], []);
});

test("isolate hides the others and toggles back to all", () => {
  const all = [1, 2, 3];
  const isolated = toggleIsolated(new Set(), all, 2);
  assert.deepEqual([...isolated].sort(), [1, 3]);
  assert.ok(isIsolated(isolated, all, 2));
  assert.equal(toggleIsolated(isolated, all, 2).size, 0);
  assert.ok(!isIsolated(new Set(), [1], 1));
});

test("hidden ids of vanished bodies are dropped", () => {
  assert.deepEqual([...pruneHidden(new Set([1, 5]), [1, 2])], [1]);
});

test("row clicks replace, toggle and take ranges", () => {
  const order = [1, 2, 3, 4];
  const plain = clickRows(order, [], null, 2, { ctrl: false, shift: false });
  assert.deepEqual(plain, { ids: [2], anchor: 2 });
  assert.deepEqual(clickRows(order, [2], 2, 4, { ctrl: true, shift: false }).ids, [2, 4]);
  assert.deepEqual(clickRows(order, [2, 4], 4, 4, { ctrl: true, shift: false }).ids, [2]);
  assert.deepEqual(clickRows(order, [2], 2, 4, { ctrl: false, shift: true }), { ids: [2, 3, 4], anchor: 2 });
});

test("hiding a body removes its triangles and edges but keeps ids", () => {
  const mesh = {
    header: {},
    indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
    edgePositions: new Float32Array(12),
    faces: [{ id: 0, start: 0, count: 3, body: 1 }, { id: 1, start: 3, count: 3, body: 2 }, { id: 2, start: 6, count: 0, body: null }],
    edges: [{ id: 0, start: 0, count: 2, body: 1 }, { id: 1, start: 2, count: 2, body: 2 }],
    vertices: [{ id: 0, body: 1, position: [0, 0, 0] }, { id: 1, body: 2, position: [1, 0, 0] }],
  };
  const out = filterHidden(mesh, new Set([2]));
  assert.deepEqual([...out.indices], [0, 1, 2]);
  assert.deepEqual(out.faces.map((f) => f.id), [0, 1, 2]);
  assert.equal(out.faces[1].count, 0);
  assert.equal(out.edgePositions.length, 6);
  assert.deepEqual(out.vertices.map((v) => v.id), [0]);
});

test("double-click on a face selects its body; edges, vertices and empty space do not", () => {
  const bodyOf = (f) => (f === 4 ? 2 : undefined);
  assert.equal(doubleClickBody({ kind: "face", id: 4 }, bodyOf), 2);
  assert.equal(doubleClickBody({ kind: "face", id: 9 }, bodyOf), null);
  assert.equal(doubleClickBody({ kind: "edge", id: 4 }, bodyOf), null);
  assert.equal(doubleClickBody(null, bodyOf), null);
});
