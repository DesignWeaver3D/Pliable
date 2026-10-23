import test from "node:test";
import assert from "node:assert/strict";
import { addRectangle, addPolygon, addCircle, addSlot, polygonCorners } from "../src/sketchbuilders.ts";

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
      if (auto === "none" || (auto === "snaps" && kind === "shape")) return;
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

test("a centred rectangle spans both sides of its centre; a flat one is refused", () => {
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
  assert.equal(poly.s.entities.length, 6);
  assert.equal(poly.s.constraints.length, 5);
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
