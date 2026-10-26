import test from "node:test";
import assert from "node:assert/strict";
import { context } from "./helpers_context.mjs";
import { addTangentArc, tangentStart, tangentArcTo } from "../src/sketchtangentarc.ts";

function withLine() {
  const ctx = context();
  ctx.s.points.push({ id: 1, u: 0, v: 0 }, { id: 2, u: 10, v: 0 });
  ctx.s.entities.push({ id: 3, type: "line", a: 1, b: 2 });
  return ctx;
}

test("a tangent arc leaves the end of a line and turns left to a point above it", () => {
  const ctx = withLine();
  const start = tangentStart(ctx.s, { id: 2, u: 10, v: 0 });
  assert.equal(start.tangent, 3);
  addTangentArc(ctx, start, { u: 20, v: 10 });
  const arc = ctx.s.entities.find((e) => e.type === "arc");
  const centre = ctx.s.points.find((p) => p.id === arc.center);
  assert.deepEqual([centre.u, centre.v], [10, 10]);
  assert.equal(arc.start, 2); // counterclockwise from the line's end
  assert.deepEqual(ctx.s.constraints.map((c) => [c.type, c.entities]), [["tangent", [arc.id, 3]]]);
});

test("a tangent arc to a point below runs clockwise, so it is stored from the end click back to the start", () => {
  const ctx = withLine();
  addTangentArc(ctx, tangentStart(ctx.s, { id: 2, u: 10, v: 0 }), { u: 20, v: -10 });
  const arc = ctx.s.entities.find((e) => e.type === "arc");
  assert.equal(arc.end, 2);
  assert.deepEqual(ctx.s.points.find((p) => p.id === arc.center) && [ctx.s.points.find((p) => p.id === arc.center).u, ctx.s.points.find((p) => p.id === arc.center).v], [10, -10]);
});

test("clicking a line starts at its nearer end, and the tangent is added even with automatic constraints off", () => {
  const ctx = context("none");
  ctx.s.points.push({ id: 1, u: 0, v: 0 }, { id: 2, u: 10, v: 0 });
  ctx.s.entities.push({ id: 3, type: "line", a: 1, b: 2 });
  const start = tangentStart(ctx.s, { u: 2, v: 0, on: { entity: 3 } });
  assert.equal(start.id, 1);
  addTangentArc(ctx, start, { u: -10, v: 10 }); // the line's start continues leftward
  assert.equal(ctx.s.constraints.length, 1);
  const arc = ctx.s.entities.find((e) => e.type === "arc");
  assert.equal(arc.end, 1); // leaving leftwards and turning up is clockwise
});

test("it continues an arc at either end", () => {
  const ctx = context();
  ctx.s.points.push({ id: 1, u: 0, v: 0 }, { id: 2, u: 10, v: 0 }, { id: 3, u: 0, v: 10 });
  ctx.s.entities.push({ id: 4, type: "arc", center: 1, start: 2, end: 3 }); // quarter circle
  const atEnd = tangentStart(ctx.s, { id: 3, u: 0, v: 10 });
  const arc = tangentArcTo({ u: 0, v: 10 }, { u: -1, v: 0 }, { u: -10, v: 20 });
  assert.ok(!arc.counterclockwise); // the end is on the right of the way out
  addTangentArc(ctx, atEnd, { u: -10, v: 20 });
  assert.equal(ctx.s.entities.length, 2);
  const atStart = tangentStart(ctx.s, { id: 2, u: 10, v: 0 });
  assert.equal(atStart.tangent, 4);
});

test("refuses a point that is not the end of a line or arc, and an end straight ahead", () => {
  const ctx = withLine();
  assert.equal(typeof tangentStart(ctx.s, { u: 5, v: 5 }), "string");
  addTangentArc(ctx, tangentStart(ctx.s, { id: 2, u: 10, v: 0 }), { u: 20, v: 0 });
  assert.equal(ctx.s.entities.length, 1);
  assert.equal(ctx.messages.length, 1);
  assert.equal(ctx.undos, 0);
});
