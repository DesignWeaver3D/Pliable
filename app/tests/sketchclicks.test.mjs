import test from "node:test";
import assert from "node:assert/strict";
import { cornerClick, cutClick, tangentClick } from "../src/sketchclicks.ts";

// A stand-in for the sketch mode: the fields the click tools read and write, with undo and solving as counters.
function context(tool, s) {
  return {
    s,
    tool,
    selection: [],
    rectOptions: { size: 2 },
    arcOptions: { radius: 3 },
    options: { auto: "shape" },
    cornerFirst: null,
    tanPicks: [],
    trimCandidates: new Set(),
    undos: 0,
    solves: 0,
    messages: [],
    pushUndo() { this.undos++; },
    resolve() { this.solves++; },
    status(text, error) { this.messages.push({ text, error }); },
  };
}
const plane = { origin: [0, 0, 0], normal: [0, 0, 1], xdir: [1, 0, 0] };
const corner = () => ({
  plane,
  points: [{ id: 1, u: 0, v: 10 }, { id: 2, u: 0, v: 0 }, { id: 3, u: 10, v: 0 }],
  entities: [{ id: 10, type: "line", a: 1, b: 2 }, { id: 11, type: "line", a: 2, b: 3 }],
  constraints: [],
});
const crossed = () => ({
  plane,
  points: [{ id: 1, u: 0, v: 0 }, { id: 2, u: 10, v: 0 }, { id: 3, u: 5, v: -2 }, { id: 4, u: 5, v: 2 }],
  entities: [{ id: 10, type: "line", a: 1, b: 2 }, { id: 11, type: "line", a: 3, b: 4 }],
  constraints: [],
});

test("a fillet click on a corner rounds it, and a click off the geometry only says so", () => {
  const ctx = context("fillet", corner());
  cornerClick(ctx, { kind: "point", id: 2 }, [0, 0]);
  assert.ok(ctx.s.entities.some((e) => e.type === "arc"));
  assert.equal(ctx.undos, 1);
  assert.equal(ctx.solves, 1);
  assert.equal(ctx.messages.at(-1).text, "Rounded the corner");
  const none = context("chamfer", corner());
  cornerClick(none, null, [50, 50]);
  assert.equal(none.undos, 0);
  assert.equal(none.messages[0].error, true);
});

test("two curves are picked one after another for a fillet", () => {
  const apart = corner();
  apart.points.push({ id: 4, u: 20, v: 0 }, { id: 5, u: 20, v: 10 });
  apart.entities = [{ id: 10, type: "line", a: 1, b: 2 }, { id: 11, type: "line", a: 4, b: 5 }]; // lines that do not meet
  const ctx = context("fillet", apart);
  cornerClick(ctx, { kind: "entity", id: 10 }, [0, 5]);
  assert.equal(ctx.cornerFirst, 10);
  assert.deepEqual(ctx.selection, [{ kind: "entity", id: 10 }]);
  cornerClick(ctx, { kind: "entity", id: 10 }, [0, 5]); // the same curve again is refused
  assert.equal(ctx.cornerFirst, null);
  assert.equal(ctx.messages.at(-1).error, true);
});

test("trim marks the piece on the first click and the second click deletes it", () => {
  const ctx = context("trim", crossed());
  cutClick(ctx, { kind: "entity", id: 10 }, [2, 0]);
  assert.equal(ctx.undos, 1);
  assert.equal(ctx.trimCandidates.size, 1);
  const marked = [...ctx.trimCandidates][0];
  cutClick(ctx, { kind: "entity", id: marked }, [2, 0]);
  assert.equal(ctx.s.entities.some((e) => e.id === marked), false);
  assert.equal(ctx.trimCandidates.size, 0);
});

test("trim works on a circle, and says so when a whole circle has too few crossings", () => {
  const s = {
    plane,
    points: [{ id: 1, u: 5, v: 0 }, { id: 2, u: -10, v: 0 }, { id: 3, u: 20, v: 0 }],
    entities: [{ id: 10, type: "circle", center: 1, radius: 3 }, { id: 11, type: "line", a: 2, b: 3 }],
    constraints: [],
  };
  const ctx = context("trim", s);
  cutClick(ctx, { kind: "entity", id: 10 }, [5, 3]);
  assert.equal(ctx.undos, 1);
  assert.equal(ctx.trimCandidates.size, 1);
  assert.equal(ctx.s.entities.filter((e) => e.type === "arc").length, 2);
  const lone = context("trim", { plane, points: [{ id: 1, u: 5, v: 0 }], entities: [{ id: 10, type: "circle", center: 1, radius: 3 }], constraints: [] });
  cutClick(lone, { kind: "entity", id: 10 }, [5, 3]);
  assert.equal(lone.undos, 0);
  assert.equal(lone.messages[0].error, true);
});

test("split cuts a line where clicked, and refuses a click at its end", () => {
  const ctx = context("split", crossed());
  cutClick(ctx, { kind: "entity", id: 10 }, [3, 0]);
  assert.equal(ctx.s.entities.filter((e) => e.type === "line").length, 3);
  const end = context("split", crossed());
  cutClick(end, { kind: "entity", id: 10 }, [0.1, 0]);
  assert.equal(end.undos, 0);
  assert.equal(end.messages[0].error, true);
});

test("extend stretches a line to the next curve", () => {
  const s = crossed();
  s.points[1].u = 3; // the line now stops short of the vertical one at u 5
  const ctx = context("extend", s);
  cutClick(ctx, { kind: "entity", id: 10 }, [3, 0]);
  assert.equal(ctx.undos, 1);
  assert.equal(ctx.s.points.find((p) => p.id === 2).u, 5);
});

test("tangent picks collect curves, and the third makes the circle", () => {
  const s = {
    plane,
    points: [{ id: 1, u: 0, v: 0 }, { id: 2, u: 4, v: 0 }, { id: 3, u: 0, v: 3 }],
    entities: [{ id: 10, type: "line", a: 1, b: 2 }, { id: 11, type: "line", a: 2, b: 3 }, { id: 12, type: "line", a: 3, b: 1 }],
    constraints: [],
  };
  const ctx = context("tancircle", s);
  tangentClick(ctx, { kind: "entity", id: 10 }, [2, 0]);
  tangentClick(ctx, { kind: "entity", id: 11 }, [2, 1.5]);
  assert.deepEqual(ctx.tanPicks, [10, 11]);
  tangentClick(ctx, { kind: "entity", id: 12 }, [0, 1.5]);
  assert.deepEqual(ctx.tanPicks, []);
  assert.ok(ctx.s.entities.some((e) => e.type === "circle"));
  assert.equal(ctx.messages.at(-1).text, "Made the tangent circle");
});
