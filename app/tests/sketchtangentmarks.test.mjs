import test from "node:test";
import assert from "node:assert/strict";
import { tangentSpots } from "../src/sketchtangentmarks.ts";

const sketchOf = (points, entities) => ({ plane: { origin: [0, 0, 0], normal: [0, 0, 1], xdir: [1, 0, 0] }, points, entities, constraints: [] });
const near = (a, b) => Math.abs(a - b) < 1e-9;

test("a line tangent to a circle is marked where it touches, out of the circle", () => {
  const s = sketchOf(
    [{ id: 1, u: 0, v: 0 }, { id: 2, u: -5, v: 4 }, { id: 3, u: 5, v: 4 }],
    [{ id: 10, type: "circle", center: 1, radius: 4 }, { id: 11, type: "line", a: 2, b: 3 }],
  );
  const [spot] = tangentSpots(s, { id: 20, type: "tangent", entities: [10, 11] });
  assert.ok(near(spot.u, 0) && near(spot.v, 4));
  assert.ok(near(spot.out[0], 0) && near(spot.out[1], 1));
});

test("two circles touching outside are marked at the touching point, beside the contact", () => {
  const s = sketchOf(
    [{ id: 1, u: 0, v: 0 }, { id: 2, u: 7, v: 0 }],
    [{ id: 10, type: "circle", center: 1, radius: 3 }, { id: 11, type: "circle", center: 2, radius: 4 }],
  );
  const [spot] = tangentSpots(s, { id: 20, type: "tangent", entities: [10, 11] });
  assert.ok(near(spot.u, 3) && near(spot.v, 0));
  assert.ok(near(spot.out[0], 0) && near(Math.abs(spot.out[1]), 1));
});

test("a circle inside another touches on the far side", () => {
  const s = sketchOf(
    [{ id: 1, u: 0, v: 0 }, { id: 2, u: 2, v: 0 }],
    [{ id: 10, type: "circle", center: 1, radius: 5 }, { id: 11, type: "circle", center: 2, radius: 3 }],
  );
  const [spot] = tangentSpots(s, { id: 20, type: "tangent", entities: [10, 11] });
  assert.ok(near(spot.u, 5) && near(spot.v, 0));
});
