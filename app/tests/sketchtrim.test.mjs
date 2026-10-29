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

test("an arc cuts the line where the line meets the arc's own sweep, not the rest of its circle", () => {
  // upper half arc centered at (5,0) radius 3 (counterclockwise from (8,0) to (2,0)); a line along y=0 from 0 to 10 meets that circle at x=2 and x=8, both arc ends
  // and a second line from (0,2) to (10,2) crosses the upper arc at two places and the lower half of the circle nowhere
  const s = {
    plane: { origin: [0, 0, 0], normal: [0, 0, 1], xdir: [1, 0, 0] },
    points: [{ id: 1, u: 0, v: 2 }, { id: 2, u: 10, v: 2 }, { id: 3, u: 5, v: 0 }, { id: 4, u: 8, v: 0 }, { id: 5, u: 2, v: 0 }],
    entities: [{ id: 10, type: "line", a: 1, b: 2 }, { id: 11, type: "arc", center: 3, start: 4, end: 5 }],
    constraints: [],
  };
  const first = trimClick(s, 10, 1, 2, new Set());
  const lines = first.sketch.entities.filter((e) => e.type === "line");
  assert.equal(lines.length, 3); // cut at both crossings of the upper arc
  const marked = lines.filter((e) => e.construction);
  assert.equal(marked.length, 1);
  const ends = [marked[0].a, marked[0].b].map((i) => first.sketch.points.find((p) => p.id === i).u).sort((x, y) => x - y);
  assert.ok(Math.abs(ends[0]) < 1e-9 && Math.abs(ends[1] - (5 - Math.sqrt(5))) < 1e-6, String(ends));
  // a line under the arc meets nothing
  const under = { ...s, points: s.points.map((p) => (p.id === 1 || p.id === 2 ? { ...p, v: -2 } : p)) };
  assert.equal(trimClick(under, 10, 1, -2, new Set()).sketch.entities.filter((e) => e.type === "line").length, 1);
});

test("cutting at two crossings joins only neighboring pieces with collinear constraints", () => {
  const first = trimClick(crossed(), 10, 1, 0, new Set());
  const ends = (id) => { const e = first.sketch.entities.find((x) => x.id === id); return new Set([e.a, e.b]); };
  const collinear = first.sketch.constraints.filter((c) => c.type === "collinear");
  assert.equal(collinear.length, 2);
  for (const c of collinear) assert.ok([...ends(c.entities[0])].some((p) => ends(c.entities[1]).has(p)), "pieces share an end point");
});
