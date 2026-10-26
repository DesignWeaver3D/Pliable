import test from "node:test";
import assert from "node:assert/strict";
import { context } from "./helpers_context.mjs";
import { addArcRadius, arcByRadius, arcClick, defaultArcOptions } from "../src/sketcharcoptions.ts";
import { addArc } from "../src/sketchbuilders.ts";

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test("a typed start angle turns the start click to that direction, keeping its distance", () => {
  const out = arcClick([{ u: 0, v: 0 }], { u: 3, v: 4 }, { ...defaultArcOptions(), startAngle: 90 });
  near(out.u, 0);
  near(out.v, 5);
  assert.equal(out.id, undefined);
  assert.deepEqual(arcClick([{ u: 0, v: 0 }], { u: 3, v: 4 }, defaultArcOptions()), { u: 3, v: 4 });
});

test("a typed sweep places the end that many degrees counterclockwise from the start, and the arc is counterclockwise", () => {
  const ctx = context();
  const centre = { u: 0, v: 0 };
  const start = { u: 5, v: 0 };
  const end = arcClick([centre, start], { u: 5, v: -1 }, { ...defaultArcOptions(), sweep: 270 });
  near(end.u, 0);
  near(end.v, -5);
  addArc(ctx, centre, start, end, true);
  const arc = ctx.s.entities[0];
  assert.equal(ctx.s.points.find((p) => p.id === arc.start).u, 5);
  near(ctx.s.points.find((p) => p.id === arc.end).v, -5);
});

test("the pointer picks which of the four arcs of the radius is made", () => {
  // Ends (-3, 0) and (3, 0), radius 5: centres at (0, 4) and (0, -4).
  const s = { u: -3, v: 0 };
  const e = { u: 3, v: 0 };
  const up = arcByRadius(s, e, 5, { u: 0, v: 1 }); // a shallow arc bulging up: centre below
  assert.deepEqual([up.centre.u, up.centre.v], [0, -4]);
  const upBig = arcByRadius(s, e, 5, { u: 0, v: 8.5 }); // a large arc bulging up: centre above
  assert.deepEqual([upBig.centre.u, upBig.centre.v], [0, 4]);
  const down = arcByRadius(s, e, 5, { u: 0, v: -1 });
  assert.deepEqual([down.centre.u, down.centre.v], [0, 4]);
  assert.equal(arcByRadius(s, e, 2, { u: 0, v: 1 }), null);
});

test("Arc by ends and radius makes a counterclockwise arc between the clicked points and keeps the radius as a dimension", () => {
  const ctx = context();
  const a = { u: -3, v: 0 };
  const b = { u: 3, v: 0 };
  addArcRadius(ctx, a, b, { u: 0, v: -1 }, 5); // bulging down, shallow: centre above, runs left to right counterclockwise
  const arc = ctx.s.entities[0];
  assert.equal(ctx.s.points.find((p) => p.id === arc.start).u, -3);
  assert.equal(ctx.s.points.find((p) => p.id === arc.end).u, 3);
  assert.deepEqual(ctx.s.constraints.map((c) => [c.type, c.value]), [["radius", 5]]);
  assert.equal(ctx.s.constraints[0].auto, undefined);
  const tooSmall = context();
  addArcRadius(tooSmall, a, b, { u: 0, v: 1 }, 2);
  assert.equal(tooSmall.s.entities.length, 0);
  assert.equal(tooSmall.messages.length, 1);
});
