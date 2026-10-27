import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { pieAngleAt, pieLines, piePoint, pieTangent } from "../src/piegizmo.ts";

// A ring of radius 10 about the z axis through the origin; the grip was computed at 90 degrees, so the source is at (10, 0, 0).
const info = { ring: [0, 0, 0, 10], axis: [0, 0, 1], anchor: [0, 10, 0], value: 90 };
const near = (a, b) => assert.ok(a.distanceTo(new THREE.Vector3(...b)) < 1e-9, `${a.toArray()} vs ${b}`);

test("the source is the grip turned back and the ring point follows the angle", () => {
  near(piePoint(info, 0), [10, 0, 0]);
  near(piePoint(info, 90), [0, 10, 0]);
  near(piePoint(info, 180), [-10, 0, 0]);
  near(pieTangent(info, 0), [0, 1, 0]);
});

test("the pointer's angle is measured round the axis from the source and unwrapped near the current value", () => {
  const down = new THREE.Vector3(0, 0, -1);
  const above = (x, y) => new THREE.Vector3(x, y, 50);
  assert.ok(Math.abs(pieAngleAt(info, above(0, 7), down, 90) - 90) < 1e-9);
  assert.ok(Math.abs(pieAngleAt(info, above(-5, 0), down, 170) - 180) < 1e-9);
  assert.ok(Math.abs(pieAngleAt(info, above(0, -5), down, 250) - 270) < 1e-9); // past 180 it keeps counting up
  assert.ok(Math.abs(pieAngleAt(info, above(0, -5), down, -80) + 90) < 1e-9); // and the other way round
  assert.equal(pieAngleAt(info, new THREE.Vector3(0, 0, 50), new THREE.Vector3(1, 0, 0), 0), null); // a ray along the ring's plane
});

test("the slice has an arc from the source to the angle and a short line toward the axis at each end", () => {
  const lines = pieLines(info, 120);
  near(lines.arc[0], [10, 0, 0]);
  near(lines.arc[lines.arc.length - 1], [10 * Math.cos(Math.PI * 2 / 3), 10 * Math.sin(Math.PI * 2 / 3), 0]);
  near(lines.first[0], [10, 0, 0]);
  assert.ok(lines.first[1].length() < 10 && lines.first[1].length() > 5); // pointing in, not through the axis
  assert.ok(Math.abs(lines.last[0].length() - 10) < 1e-9);
});
