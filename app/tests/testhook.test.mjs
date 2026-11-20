import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { distanceToSegment } from "../src/testhook.ts";

const v = (x, y, z = 0) => new THREE.Vector3(x, y, z);

test("a point on a segment is at distance zero, also at its ends", () => {
  assert.equal(distanceToSegment(v(5, 0), v(0, 0), v(10, 0)), 0);
  assert.equal(distanceToSegment(v(0, 0), v(0, 0), v(10, 0)), 0);
  assert.equal(distanceToSegment(v(10, 0), v(0, 0), v(10, 0)), 0);
});

test("beside a segment the distance is the perpendicular one; past an end it is to that end", () => {
  assert.equal(distanceToSegment(v(5, 3), v(0, 0), v(10, 0)), 3);
  assert.equal(distanceToSegment(v(13, 4), v(0, 0), v(10, 0)), 5);
  assert.equal(distanceToSegment(v(-3, 4, 0), v(0, 0), v(10, 0)), 5);
});

test("a segment of no length is treated as its one point", () => {
  assert.equal(distanceToSegment(v(3, 4), v(0, 0), v(0, 0)), 5);
});
