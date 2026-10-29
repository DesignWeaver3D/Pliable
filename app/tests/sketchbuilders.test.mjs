import test from "node:test";
import assert from "node:assert/strict";
import { addArc, addEllipse, addEllipseArc, addRectangle, addPolygon, addCircle, addSlot, polygonCorners } from "../src/sketchbuilders.ts";

// A stand-in for the sketch mode: the same rules as SketchMode.pointFor and addConstraintRaw, with undo and solving as counters.
function context(auto = "shape") {
  const ctx = {
    s: { plane: { origin: [0, 0, 0], normal: [0, 0, 1], xdir: [1, 0, 0] }, points: [], entities: [], constraints: [] },
    chain: [],
    rectOptions: { corner: "none", size: 5 },
    undos: 0,
    solves: 0,
    pushUndo() { this.undos++; },
    resolve() { this.solves++; return Promise.resolve(true); },
    pointFor(snap) {
      if (snap.id !== undefined) return snap.id;
      const id = this.s.points.length + this.s.entities.length + this.s.constraints.length + 1;
      this.s.points.push({ id, u: snap.u, v: snap.v });
      snap.id = id;
      return id;
    },
    addConstraintRaw(c, kind = "shape") {
      if (kind !== "always" && (auto === "none" || (auto === "snaps" && kind === "shape"))) return;
      this.s.constraints.push({ id: this.s.points.length + this.s.entities.length + this.s.constraints.length + 1, ...c, auto: true });
    },
    status() {},
  };
  return ctx;
}

test("a rectangle is four lines, horizontal and vertical when shape constraints are on", () => {
  const ctx = context();
  addRectangle(ctx, { u: 0, v: 0 }, { u: 4, v: 3 });
  assert.equal(ctx.s.points.length, 4);
  assert.equal(ctx.s.entities.filter((e) => e.type === "line").length, 4);
  assert.deepEqual(ctx.s.constraints.map((c) => c.type), ["horizontal", "vertical", "horizontal", "vertical"]);
  assert.equal(ctx.undos, 1);
  assert.equal(ctx.solves, 1);
  const off = context("none");
  addRectangle(off, { u: 0, v: 0 }, { u: 4, v: 3 });
  assert.equal(off.s.constraints.length, 0);
});

test("a centered rectangle spans both sides of its center; a flat one is refused", () => {
  const ctx = context();
  addRectangle(ctx, { u: 0, v: 0 }, { u: 2, v: 1 }, true);
  const us = ctx.s.points.map((p) => p.u).sort((a, b) => a - b);
  assert.deepEqual([us[0], us[3]], [-2, 2]);
  const flat = context();
  addRectangle(flat, { u: 0, v: 0 }, { u: 4, v: 0 });
  assert.equal(flat.undos, 0);
});

test("a rounded rectangle has four lines, four arcs and tangent constraints", () => {
  const ctx = context();
  ctx.rectOptions = { corner: "fillet", size: 1 };
  addRectangle(ctx, { u: 0, v: 0 }, { u: 10, v: 6 });
  assert.equal(ctx.s.entities.filter((e) => e.type === "arc").length, 4);
  assert.equal(ctx.s.constraints.filter((c) => c.type === "tangent").length, 8);
});

test("a polygon, circle and slot add their curves", () => {
  const poly = context();
  addPolygon(poly, { u: 0, v: 0 }, { u: 5, v: 0 }, 6);
  const circles = poly.s.entities.filter((e) => e.type === "circle");
  assert.equal(poly.s.entities.length, 8); // six sides and the two construction circles
  assert.ok(circles.length === 2 && circles.every((c) => c.construction));
  assert.ok(Math.abs(circles[0].radius - 5) < 1e-9 && Math.abs(circles[1].radius - 5 * Math.cos(Math.PI / 6)) < 1e-9);
  assert.equal(poly.s.constraints.length, 5 + 6 + 1); // equal sides, corners on the major circle, the minor circle tangent to a side
  const bare = context("none");
  addPolygon(bare, { u: 0, v: 0 }, { u: 5, v: 0 }, 5);
  assert.equal(bare.s.constraints.length, 4 + 5 + 1); // whatever the automatic constraint option says
  assert.equal(polygonCorners({ u: 0, v: 0 }, { u: 1, v: 0 }, 4).length, 4);
  const circle = context();
  addCircle(circle, { u: 1, v: 1 }, { u: 4, v: 5 });
  assert.equal(circle.s.entities[0].radius, 5);
  const none = context();
  addCircle(none, { u: 1, v: 1 }, { u: 1, v: 1 });
  assert.equal(none.undos, 0);
  const slot = context();
  addSlot(slot, { u: 0, v: 0 }, { u: 10, v: 0 }, { u: 5, v: 2 });
  assert.equal(slot.s.entities.filter((e) => e.type === "arc").length, 2);
  assert.equal(slot.s.entities.filter((e) => e.type === "line").length, 2);
});

test("an arc by center follows the pointer: counterclockwise or clockwise from the start", () => {
  const sweepOf = (ctx) => {
    const arc = ctx.s.entities.find((e) => e.type === "arc");
    const at = (id) => ctx.s.points.find((p) => p.id === id);
    const [c, a, b] = [at(arc.center), at(arc.start), at(arc.end)];
    const turn = Math.atan2(b.v - c.v, b.u - c.u) - Math.atan2(a.v - c.v, a.u - c.u);
    return ((turn + 4 * Math.PI) % (2 * Math.PI)) * (180 / Math.PI); // the stored counterclockwise sweep
  };
  const up = context("none");
  addArc(up, { u: 0, v: 0 }, { u: 10, v: 0 }, { u: 0, v: 10 });
  assert.ok(Math.abs(sweepOf(up) - 90) < 1e-6); // pointer moved counterclockwise: start stays the arc's start
  const down = context("none");
  addArc(down, { u: 0, v: 0 }, { u: 10, v: 0 }, { u: 0, v: -10 });
  assert.ok(Math.abs(sweepOf(down) - 90) < 1e-6); // pointer moved clockwise: a 90 degree arc through the lower quadrant
  const clicked = down.s.entities.find((e) => e.type === "arc");
  assert.equal(down.s.points.find((p) => p.id === clicked.end).v, 0); // runs from the pointer's end back to the start
  const typed = context("none");
  addArc(typed, { u: 0, v: 0 }, { u: 10, v: 0 }, { u: 0, v: -10 }, true);
  assert.ok(Math.abs(sweepOf(typed) - 270) < 1e-6); // typed sweeps stay counterclockwise
});

test("an ellipse gets two construction lines joining the opposite ends of its axes", () => {
  const ctx = context("none");
  addEllipse(ctx, { u: 0, v: 0 }, { u: 10, v: 0 }, { u: 0, v: 4 });
  const ellipse = ctx.s.entities.find((e) => e.type === "ellipse");
  const lines = ctx.s.entities.filter((e) => e.type === "line");
  assert.equal(lines.length, 2);
  assert.ok(lines.every((l) => l.construction));
  const ends = lines.map((l) => [l.a, l.b].sort((x, y) => x - y)).sort();
  assert.deepEqual(ends, [[ellipse.major, ellipse.major2].sort((x, y) => x - y), [ellipse.minor1, ellipse.minor2].sort((x, y) => x - y)].sort());
});

test("a rectangle drawn from its center always gets a center point held symmetric about two opposite corners", () => {
  const ctx = context("none"); // automatic constraints off: the center's constraints are made anyway, the shape's are not
  addRectangle(ctx, { u: 3, v: 2 }, { u: 7, v: 5 }, true);
  assert.equal(ctx.s.points.length, 5);
  const centre = ctx.s.points.find((p) => p.u === 3 && p.v === 2);
  assert.equal(ctx.s.constraints.length, 1);
  const [c] = ctx.s.constraints;
  assert.equal(c.type, "symmetric_point");
  assert.equal(c.point, centre.id);
  const [p, q] = c.points.map((id) => ctx.s.points.find((x) => x.id === id));
  assert.deepEqual([(p.u + q.u) / 2, (p.v + q.v) / 2], [3, 2]);
  assert.notDeepEqual([p.u, p.v], [q.u, q.v]);
});

test("a center clicked on a curve, a sketch axis or a point is made coincident with it; rounded corners get the same center", () => {
  const onLine = context("none");
  addRectangle(onLine, { u: 3, v: 2, on: { entity: 99 } }, { u: 7, v: 5 }, true);
  assert.ok(onLine.s.constraints.some((c) => c.type === "point_on" && c.entity === 99));
  const onAxis = context("none");
  addRectangle(onAxis, { u: 5, v: 0 }, { u: 7, v: 3 }, true);
  assert.ok(onAxis.s.constraints.some((c) => c.type === "point_on" && c.entity === -1));
  const onPoint = context("none");
  onPoint.s.points.push({ id: 50, u: 3, v: 2 });
  addRectangle(onPoint, { id: 50, u: 3, v: 2 }, { u: 7, v: 5 }, true);
  assert.equal(onPoint.s.points.length, 5);
  assert.ok(onPoint.s.constraints.some((c) => c.type === "symmetric_point" && c.point === 50));
  assert.equal(onPoint.s.constraints.some((c) => c.type === "point_on"), false);
  const rounded = context("none");
  rounded.rectOptions = { corner: "fillet", size: 1 };
  addRectangle(rounded, { u: 3, v: 2 }, { u: 7, v: 5 }, true);
  const sym = rounded.s.constraints.find((c) => c.type === "symmetric_point");
  const [p, q] = sym.points.map((id) => rounded.s.points.find((x) => x.id === id));
  assert.deepEqual([(p.u + q.u) / 2, (p.v + q.v) / 2], [3, 2]);
});

test("an elliptical arc is an ellipse with start and end points on it, running counterclockwise from the start", () => {
  const ctx = context("none");
  addEllipseArc(ctx, { u: 0, v: 0 }, { u: 10, v: 0 }, { u: 0, v: 4 }, { u: 20, v: 0 }, { u: 0, v: 9 });
  const arc = ctx.s.entities.find((e) => e.type === "ellipse");
  const at = (id) => ctx.s.points.find((p) => p.id === id);
  assert.equal(arc.start, arc.major); // the start is the end of the long axis, so it is that point
  assert.ok(Math.abs(at(arc.end).u) < 1e-9 && Math.abs(at(arc.end).v - 4) < 1e-9); // taken to the ellipse by angle
  assert.equal(ctx.s.entities.filter((e) => e.type === "line").length, 2);
});

test("an elliptical arc whose end is clicked clockwise from the start is stored counterclockwise", () => {
  const ctx = context("none");
  addEllipseArc(ctx, { u: 0, v: 0 }, { u: 10, v: 0 }, { u: 0, v: 4 }, { u: 0, v: 5 }, { u: 5, v: 0.1 });
  const arc = ctx.s.entities.find((e) => e.type === "ellipse");
  const at = (id) => ctx.s.points.find((p) => p.id === id);
  assert.ok(Math.abs(at(arc.start).v) < 1 && at(arc.start).u > 0); // the pointer went clockwise, so the arc starts at the clicked end
  assert.ok(Math.abs(at(arc.end).u) < 1e-9 && at(arc.end).v > 0);
});
