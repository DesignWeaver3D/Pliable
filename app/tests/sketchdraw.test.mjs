import test from "node:test";
import assert from "node:assert/strict";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { COLORS, drawAxes, drawCentres, isMarked, isPlaced, segments, setLine, world } from "../src/sketchdraw.ts";

const plane = { origin: [0, 0, 5], normal: [0, 0, 1], xdir: [1, 0, 0] };
const layer = () => new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ linewidth: 2 }));
function context(s) {
  return { s, selection: [], highlight: [], hover: null, freedom: new Map(), failed: new Set(), freeSizes: new Set(), axes: layer(), centres: layer(), centreColours: new Map(), centresAt: 0, pixelAt: () => 0.5 };
}
const circle = () => ({
  plane,
  points: [{ id: 1, u: 2, v: 3 }, { id: 2, u: 4, v: 3 }],
  entities: [{ id: 10, type: "circle", center: 1, edge: 2 }],
  constraints: [],
});

test("world and segments put sketch coordinates on the plane", () => {
  const ctx = context(circle());
  assert.deepEqual(world(ctx, 2, 3).toArray(), [2, 3, 5]);
  assert.deepEqual(segments(ctx, [[[0, 0], [1, 0], [1, 1]]]), [0, 0, 5, 1, 0, 5, 1, 0, 5, 1, 1, 5]);
});

test("a curve is marked when selected, lit up or hovered", () => {
  const ctx = context(circle());
  const sel = { kind: "entity", id: 10 };
  assert.equal(isMarked(ctx, sel), false);
  ctx.hover = sel;
  assert.equal(isMarked(ctx, sel), true);
  ctx.hover = null;
  ctx.highlight = [sel];
  assert.equal(isMarked(ctx, sel), true);
  ctx.highlight = [];
  ctx.selection = [{ kind: "entity", id: 10 }];
  assert.equal(isMarked(ctx, sel), true);
  assert.equal(isMarked(ctx, { kind: "point", id: 10 }), false);
});

test("a curve is placed once every one of its points has no freedom", () => {
  const ctx = context(circle());
  const e = ctx.s.entities[0];
  assert.equal(isPlaced(ctx, e), false, "nothing solved yet");
  ctx.freedom = new Map([[1, 0], [2, 0]]);
  assert.equal(isPlaced(ctx, e), true);
  ctx.freeSizes = new Set([10]);
  assert.equal(isPlaced(ctx, e), false, "a free size keeps it from being placed");
  ctx.freeSizes = new Set();
  ctx.failed = new Set([1]);
  assert.equal(isPlaced(ctx, e), false);
});

test("setLine hides an empty layer and fills a used one", () => {
  const line = layer();
  setLine(line, [0, 0, 0, 1, 0, 0]);
  assert.equal(line.visible, true);
  setLine(line, []);
  assert.equal(line.visible, false);
});

test("center crosses are drawn for circles and take the color set for the curve", () => {
  const ctx = context(circle());
  ctx.centreColours.set(10, COLORS.selected);
  drawCentres(ctx);
  assert.equal(ctx.centresAt, 0.5);
  assert.equal(ctx.centres.visible, true);
  assert.equal(ctx.centres.geometry.getAttribute("instanceColorStart").data.array[0] > 0.9, true, "the orange red channel");
  const none = context({ ...circle(), entities: [] });
  drawCentres(none);
  assert.equal(none.centres.visible, false);
});

test("the sketch axes are shown through the plane origin", () => {
  const ctx = context(circle());
  drawAxes(ctx);
  assert.equal(ctx.axes.visible, true);
});
