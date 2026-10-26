import test from "node:test";
import assert from "node:assert/strict";
import { freeParts, freeMessage } from "../src/sketchfreedom.ts";

const s = { points: [{ id: 1 }, { id: 2 }, { id: 3 }], entities: [{ id: 10, type: "line", a: 1, b: 2 }, { id: 11, type: "line", a: 2, b: 3 }] };

test("free points light the curves that run through them", () => {
  const parts = freeParts(s, new Map([[1, 0], [2, 0], [3, 1]]));
  assert.deepEqual([...parts.points], [3]);
  assert.deepEqual([...parts.entities], [11]);
});

test("the message says where the freedom is, or that it is in a size", () => {
  assert.match(freeMessage(freeParts(s, new Map([[3, 2]])), 2), /1 point and 1 curve/);
  assert.match(freeMessage(freeParts(s, new Map([[1, 0]])), 1), /in a size/);
  assert.match(freeMessage(freeParts(s, new Map()), 0), /Nothing/);
});
