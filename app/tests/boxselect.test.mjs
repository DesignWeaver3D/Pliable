import test from "node:test";
import assert from "node:assert/strict";
import { segmentsInBox, trianglesInBox, triangleHitsRect } from "../src/boxselect.ts";

const r = { x0: 10, x1: 20, y0: 10, y1: 20 };
const p = (x, y) => ({ x, y });

test("window needs every end inside; crossing needs any touch", () => {
  const inside = [p(12, 12), p(18, 18)];
  const through = [p(0, 15), p(30, 15)]; // passes through with both ends outside
  const partly = [p(15, 15), p(40, 15)];
  const away = [p(0, 0), p(5, 5)];
  assert.equal(segmentsInBox(inside, r, false), true);
  assert.equal(segmentsInBox(through, r, false), false);
  assert.equal(segmentsInBox(partly, r, false), false);
  assert.equal(segmentsInBox(through, r, true), true);
  assert.equal(segmentsInBox(partly, r, true), true);
  assert.equal(segmentsInBox(away, r, true), false);
});

test("a polyline edge is judged segment by segment", () => {
  const pts = [p(0, 0), p(5, 5), p(5, 5), p(30, 30)]; // second segment crosses the box
  assert.equal(segmentsInBox(pts, r, true), true);
  assert.equal(segmentsInBox(pts, r, false), false);
});

test("a face is taken by crossing when it overlaps the box without a corner inside it", () => {
  const big = [p(0, 0), p(100, 0), p(0, 100)]; // box sits wholly inside the triangle
  assert.equal(triangleHitsRect(...big, r), true);
  assert.equal(trianglesInBox(big, r, true), true);
  assert.equal(trianglesInBox(big, r, false), false);
  const near = [p(25, 0), p(40, 0), p(25, 8)]; // bounding box misses; triangle misses
  assert.equal(trianglesInBox(near, r, true), false);
  const diagonal = [p(0, 22), p(22, 0), p(30, 30)]; // bounding box overlaps the rect, triangle edge cuts the corner
  assert.equal(trianglesInBox(diagonal, r, true), true);
  const corner = [p(0, 30), p(30, 0), p(40, 40)]; // line x+y=30 passes beyond rect corner (20,20 sum 40): misses nothing? sum 30 < 40 so cuts
  assert.equal(trianglesInBox(corner, r, true), true);
  const miss = [p(0, 50), p(50, 0), p(60, 60)]; // hypotenuse x+y=50 is beyond (20,20)
  assert.equal(trianglesInBox([p(0, 50), p(50, 0), p(0, 60)], r, true), false);
  assert.ok(miss);
});

test("window takes a face only when all its triangles are inside", () => {
  const face = [p(11, 11), p(19, 11), p(11, 19), p(19, 11), p(19, 19), p(11, 19)];
  assert.equal(trianglesInBox(face, r, false), true);
  assert.equal(trianglesInBox([...face, p(30, 30), p(31, 30), p(30, 31)], r, false), false);
});

import { polylineInBox } from "../src/boxselect.ts";
import { itemsInBox } from "../src/sketchmodel.ts";

test("a polyline is selected by a window only when wholly inside, by a crossing box when touched", () => {
  const inside = [p(11, 11), p(15, 18), p(19, 12)];
  const through = [p(0, 15), p(30, 15)];
  const outside = [p(0, 0), p(5, 30)];
  assert.equal(polylineInBox(inside, r, false), true);
  assert.equal(polylineInBox(through, r, false), false);
  assert.equal(polylineInBox(through, r, true), true);
  assert.equal(polylineInBox(outside, r, true), false);
  assert.equal(polylineInBox([], r, true), false);
});

test("sketch items in a box: points by position, curves by the window and crossing rules", () => {
  const s = {
    plane: {},
    points: [{ id: 1, u: 12, v: 12 }, { id: 2, u: 18, v: 18 }, { id: 3, u: 40, v: 15 }, { id: 4, u: 0, v: 15 }],
    entities: [{ id: 10, type: "line", a: 1, b: 2 }, { id: 11, type: "line", a: 4, b: 3 }],
    constraints: [],
  };
  const flat = (u, v) => ({ x: u, y: v });
  const ids = (found) => found.map((f) => `${f.kind}${f.id}`).join(",");
  assert.equal(ids(itemsInBox(s, flat, r, false)), "point1,point2,entity10");
  assert.equal(ids(itemsInBox(s, flat, r, true)), "point1,point2,entity10,entity11");
});
