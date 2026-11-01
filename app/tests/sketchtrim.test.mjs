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

test("each cut point is held on the curve that crosses there, unless automatic constraints are off", () => {
  const first = trimClick(crossed(), 10, 5, 0, new Set());
  const held = first.sketch.constraints.filter((c) => c.type === "point_on").map((c) => [first.sketch.points.find((p) => p.id === c.point).u, c.entity]).sort((x, y) => x[0] - y[0]);
  assert.deepEqual(held, [[3, 11], [7, 12]]);
  assert.equal(trimClick(crossed(), 10, 5, 0, new Set(), false).sketch.constraints.some((c) => c.type === "point_on"), false);
});

const plane = { origin: [0, 0, 0], normal: [0, 0, 1], xdir: [1, 0, 0] };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`);

test("a circle crossed twice becomes arcs, the piece under the click is marked, and the cuts are held on the crossing line", () => {
  const s = {
    plane,
    points: [{ id: 1, u: 5, v: 0 }, { id: 2, u: -10, v: 0 }, { id: 3, u: 20, v: 0 }],
    entities: [{ id: 10, type: "circle", center: 1, radius: 3 }, { id: 11, type: "line", a: 2, b: 3 }],
    constraints: [{ id: 12, type: "radius", entity: 10, value: 3 }],
  };
  const first = trimClick(s, 10, 5, 3, new Set());
  const arcs = first.sketch.entities.filter((e) => e.type === "arc");
  assert.equal(arcs.length, 2);
  assert.equal(first.sketch.entities.some((e) => e.type === "circle"), false);
  const marked = arcs.filter((e) => e.construction);
  assert.equal(marked.length, 1);
  assert.deepEqual([...first.candidates], [marked[0].id]);
  const mid = (arc) => { // a point halfway round the arc counterclockwise
    const c = first.sketch.points.find((p) => p.id === arc.center);
    const a = first.sketch.points.find((p) => p.id === arc.start);
    const b = first.sketch.points.find((p) => p.id === arc.end);
    const a0 = Math.atan2(a.v - c.v, a.u - c.u);
    const sweep = (Math.atan2(b.v - c.v, b.u - c.u) - a0 + 4 * Math.PI) % (2 * Math.PI);
    return [c.u + 3 * Math.cos(a0 + sweep / 2), c.v + 3 * Math.sin(a0 + sweep / 2)];
  };
  const [mu, mv] = mid(marked[0]);
  near(mu, 5); near(mv, 3); // the marked piece is the upper half, where the click was
  const held = first.sketch.constraints.filter((c) => c.type === "point_on" && c.entity === 11);
  assert.equal(held.length, 2);
  assert.equal(first.sketch.constraints.some((c) => c.type === "radius" && c.entity === 10), true); // the dimension stays with the first piece
  const second = trimClick(first.sketch, marked[0].id, 5, 3, first.candidates);
  assert.equal(second.sketch.entities.filter((e) => e.type === "arc").length, 1);
  assert.equal(second.candidates.size, 0);
});

test("a whole circle needs two crossings, and an uncrossed arc is marked whole", () => {
  const one = {
    plane,
    points: [{ id: 1, u: 5, v: 0 }, { id: 2, u: 2, v: -10 }, { id: 3, u: 2, v: 10 }],
    entities: [{ id: 10, type: "circle", center: 1, radius: 3 }, { id: 11, type: "line", a: 2, b: 3 }],
    constraints: [],
  };
  assert.equal(typeof trimClick(one, 10, 5, 3, new Set()), "string"); // the vertical line only touches the circle at one point
  const arc = {
    plane,
    points: [{ id: 1, u: 0, v: 0 }, { id: 2, u: 3, v: 0 }, { id: 3, u: 0, v: 3 }],
    entities: [{ id: 10, type: "arc", center: 1, start: 2, end: 3 }],
    constraints: [],
  };
  const whole = trimClick(arc, 10, 2, 2, new Set());
  assert.deepEqual([...whole.candidates], [10]);
  assert.equal(whole.sketch.entities[0].construction, true);
});

test("an arc is cut into pieces at its crossings", () => {
  const s = {
    plane,
    points: [{ id: 1, u: 0, v: 0 }, { id: 2, u: 5, v: 0 }, { id: 3, u: -5, v: 0 }, { id: 4, u: -10, v: 3 }, { id: 5, u: 10, v: 3 }],
    entities: [{ id: 10, type: "arc", center: 1, start: 2, end: 3 }, { id: 11, type: "line", a: 4, b: 5 }],
    constraints: [],
  };
  const first = trimClick(s, 10, 0, 5, new Set());
  const arcs = first.sketch.entities.filter((e) => e.type === "arc");
  assert.equal(arcs.length, 3); // the line y = 3 crosses the upper half at two places
  assert.equal(arcs.filter((e) => e.construction).length, 1);
  const marked = arcs.find((e) => e.construction);
  const [a, b] = [marked.start, marked.end].map((id) => first.sketch.points.find((p) => p.id === id));
  near(a.v, 3); near(b.v, 3); // the middle piece, over the top of the line
});

test("an ellipse crossed twice by a line becomes two elliptical arcs sharing the cut points", () => {
  const s = {
    plane,
    points: [{ id: 1, u: 0, v: 0 }, { id: 2, u: 5, v: 0 }, { id: 3, u: -5, v: 0 }, { id: 4, u: 0, v: 3 }, { id: 5, u: 0, v: -3 }, { id: 6, u: 2, v: -10 }, { id: 7, u: 2, v: 10 }],
    entities: [{ id: 10, type: "ellipse", center: 1, major: 2, major2: 3, minor1: 4, minor2: 5, minor: 3 }, { id: 11, type: "line", a: 6, b: 7 }],
    constraints: [],
  };
  const first = trimClick(s, 10, 5, 0, new Set());
  const arcs = first.sketch.entities.filter((e) => e.type === "ellipse");
  assert.equal(arcs.length, 2);
  assert.ok(arcs.every((e) => e.start !== undefined && e.end !== undefined));
  assert.equal(arcs[0].end, arcs[1].start);
  const marked = arcs.find((e) => e.construction);
  assert.ok(marked);
  const [a, b] = [marked.start, marked.end].map((id) => first.sketch.points.find((p) => p.id === id));
  near(a.u, 2); near(b.u, 2);
  assert.equal(first.sketch.constraints.filter((c) => c.type === "point_on" && c.entity === 11).length, 2);
});
