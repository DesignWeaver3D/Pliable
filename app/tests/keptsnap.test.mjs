// Run with: node --test app/tests
import test from "node:test";
import assert from "node:assert/strict";
import { nearestOnSegments, sketchSnapPoints } from "../src/keptsnap.ts";

const plane = { origin: [0, 0, 5], normal: [0, 0, 1], xdir: [1, 0, 0] };
const data = {
  plane,
  points: [{ id: 1, u: 0, v: 0 }, { id: 2, u: 10, v: 0 }, { id: 3, u: 20, v: 5 }, { id: 4, u: 3, v: 3 }],
  entities: [
    { id: 11, type: "line", a: 1, b: 2 },
    { id: 12, type: "circle", center: 3, radius: 2 },
    { id: 13, type: "line", a: 1, b: 4, construction: true },
  ],
  constraints: [],
};

test("a sketch offers its line ends and middles and circle centers, not construction lines", () => {
  const labels = sketchSnapPoints(data).map((p) => `${p.label} ${p.point.join(",")}`);
  assert.deepEqual(labels, ["Sketch point 0,0,5", "Sketch point 10,0,5", "Sketch midpoint 5,0,5", "Sketch center 20,5,5"]);
});

test("the nearest point on a drawn segment is found in screen space", () => {
  const flat = (p) => ({ x: p[0], y: p[1] });
  const near = nearestOnSegments([0, 0, 0, 10, 0, 0], flat, { x: 4, y: 3 });
  assert.deepEqual(near.point, [4, 0, 0]);
  assert.equal(near.px, 3);
  assert.equal(nearestOnSegments([], flat, { x: 0, y: 0 }), null);
});
