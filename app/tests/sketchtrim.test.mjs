import test from "node:test";
import assert from "node:assert/strict";
import { trimClick } from "../src/sketchtrim.ts";

// A horizontal line 0..10 crossed by verticals at x=3 and x=7.
const crossed = () => ({
  plane: { origin: [0, 0, 0], normal: [0, 0, 1], xdir: [1, 0, 0] },
  points: [{ id: 1, u: 0, v: 0 }, { id: 2, u: 10, v: 0 }, { id: 3, u: 3, v: -2 }, { id: 4, u: 3, v: 2 }, { id: 5, u: 7, v: -2 }, { id: 6, u: 7, v: 2 }],
  entities: [{ id: 10, type: "line", a: 1, b: 2 }, { id: 11, type: "line", a: 3, b: 4 }, { id: 12, type: "line", a: 5, b: 6 }],
  constraints: [],
});

test("the first trim click cuts the line at its crossings and marks the clicked piece as construction", () => {
  const first = trimClick(crossed(), 10, 5, 0, new Set());
  const horizontal = first.sketch.entities.filter((e) => e.type === "line" && first.sketch.points.find((p) => p.id === e.a).v === 0 && first.sketch.points.find((p) => p.id === e.b).v === 0);
  assert.equal(horizontal.length, 3);
  const marked = horizontal.filter((e) => e.construction);
  assert.equal(marked.length, 1);
  const [a, b] = [first.sketch.points.find((p) => p.id === marked[0].a), first.sketch.points.find((p) => p.id === marked[0].b)];
  assert.deepEqual([Math.min(a.u, b.u), Math.max(a.u, b.u)], [3, 7]);
  assert.deepEqual([...first.candidates], [marked[0].id]);
  assert.equal(first.sketch.entities.length, 5);
});

test("a second click on the marked piece deletes it and leaves the other pieces", () => {
  const first = trimClick(crossed(), 10, 5, 0, new Set());
  const id = [...first.candidates][0];
  const second = trimClick(first.sketch, id, 5, 0, first.candidates);
  assert.equal(second.sketch.entities.some((e) => e.id === id), false);
  assert.equal(second.sketch.entities.length, 4);
  assert.equal(second.candidates.size, 0);
});

test("a click at an end piece marks only that piece", () => {
  const first = trimClick(crossed(), 10, 1, 0, new Set());
  const marked = first.sketch.entities.filter((e) => e.construction);
  assert.equal(marked.length, 1);
  const ends = [marked[0].a, marked[0].b].map((i) => first.sketch.points.find((p) => p.id === i).u).sort((x, y) => x - y);
  assert.deepEqual(ends, [0, 3]);
});

test("a line with no crossing becomes one marked piece, then is deleted", () => {
  const s = crossed();
  s.entities = [s.entities[0]];
  const first = trimClick(s, 10, 5, 0, new Set());
  assert.equal(first.sketch.entities.length, 1);
  assert.equal(first.sketch.entities[0].construction, true);
  assert.equal(trimClick(first.sketch, 10, 5, 0, first.candidates).sketch.entities.length, 0);
});
