import test from "node:test";
import assert from "node:assert/strict";
import { pendingShapes, liveDimensions } from "../src/sketchpreview.ts";

const sketch = { plane: { origin: [0, 0, 0], normal: [0, 0, 1], xdir: [1, 0, 0] }, points: [], entities: [], constraints: [] };
const context = (tool, chain, cursor, extra = {}) => ({ s: sketch, chain, cursor, tool, typed: "", sidesOf: (t) => (t === "polygon" ? 6 : undefined), ...extra });

test("a rectangle in progress is a closed outline between the first corner and the pointer", () => {
  const [ring] = pendingShapes(context("rectangle", [{ u: 0, v: 0 }], { u: 4, v: 3 }));
  assert.deepEqual(ring, [[0, 0], [4, 0], [4, 3], [0, 3], [0, 0]]);
  const [centred] = pendingShapes(context("rectcentre", [{ u: 0, v: 0 }], { u: 2, v: 1 }));
  assert.deepEqual(centred[0], [-2, -1]);
});

test("a line, circle and polygon preview from what has been clicked", () => {
  assert.deepEqual(pendingShapes(context("line", [{ u: 1, v: 1 }, { u: 2, v: 2 }], { u: 5, v: 5 })), [[[2, 2], [5, 5]]]);
  const [circle] = pendingShapes(context("circle", [{ u: 0, v: 0 }], { u: 3, v: 4 }));
  assert.equal(circle.length, 49);
  assert.ok(Math.abs(Math.hypot(...circle[7]) - 5) < 1e-9);
  const [poly] = pendingShapes(context("polygon", [{ u: 0, v: 0 }], { u: 1, v: 0 }));
  assert.equal(poly.length, 7);
  assert.deepEqual(pendingShapes(context("rectangle", [], { u: 1, v: 1 })), []);
});

test("size tags show the length and angle, the box size, a radius, or the typed text", () => {
  const text = (ctx) => liveDimensions(ctx)[0]?.text;
  assert.equal(text(context("line", [{ u: 0, v: 0 }], { u: 3, v: 4 })), "5 at 53.13°");
  assert.equal(text(context("rectangle", [{ u: 0, v: 0 }], { u: 4, v: 3 })), "4 × 3");
  assert.equal(text(context("circle", [{ u: 0, v: 0 }], { u: 3, v: 4 })), "R5");
  assert.equal(text(context("rectangle", [{ u: 0, v: 0 }], { u: 4, v: 3 }, { typed: "12" })), "12|"); // the first real dimension holds the typed value
  assert.deepEqual(liveDimensions(context("line", [], { u: 1, v: 1 })), []);
});

test("typed sizes are drawn as dimensions holding the typed values", async () => {
  const kinds = (typed, tool = "rectangle") => liveDimensions(context(tool, [{ u: 0, v: 0 }], { u: 4, v: 3 }, { typed })).map((d) => [d.kind, d.text]);
  assert.deepEqual(kinds("12"), [["linear", "12|"], ["linear", "12"]]); // a square until the height is typed
  assert.deepEqual(kinds("12 5"), [["linear", "12"], ["linear", "5|"]]);
  assert.deepEqual(kinds("7", "circle"), [["radius", "R7|"]]);
  assert.deepEqual(kinds("9", "line"), [["linear", "9|"]]);
});
