// Run with: node --test app/tests
import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { formatValue, handleValue, lineParam, travelFor } from "../src/manipulator.ts";

const h = { value: 10, scale: 1, min: 1 };

test("travel changes the value by scale times the distance, never below the minimum", () => {
  assert.equal(handleValue(h, 5), 15);
  assert.equal(handleValue({ ...h, scale: 2 }, 3), 16); // a diameter handle on a radius
  assert.equal(handleValue(h, -50), 1);
  assert.equal(handleValue({ ...h, min: null }, -50), -40);
});

test("a maximum caps the value", () => {
  const f = { value: 0.5, scale: 1, min: 0.02, max: 0.98 };
  assert.equal(handleValue(f, 5), 0.98);
  assert.equal(handleValue(f, -5), 0.02);
  assert.equal(handleValue(f, 0.1), 0.6);
});

test("travelFor is the inverse of handleValue", () => {
  assert.equal(travelFor({ value: 10, scale: 2 }, 16), 3);
  assert.equal(travelFor({ value: 10, scale: -1 }, 7), 3);
  assert.equal(travelFor({ value: 10, scale: 0 }, 7), 0);
});

test("a ray finds the closest point along the handle line", () => {
  const p = new THREE.Vector3(0, 0, 0);
  const d = new THREE.Vector3(1, 0, 0);
  // A ray from above looking straight down at x = 4 passes closest to the line at 4.
  const t = lineParam(p, d, new THREE.Vector3(4, 0, 10), new THREE.Vector3(0, 0, -1));
  assert.ok(Math.abs(t - 4) < 1e-9);
  // A slanted ray from the side still projects onto the line.
  const s = lineParam(p, d, new THREE.Vector3(-3, 5, 5), new THREE.Vector3(1, -1, -1).normalize());
  assert.ok(Number.isFinite(s));
});

test("a ray along the line has no defined position", () => {
  assert.equal(lineParam(new THREE.Vector3(), new THREE.Vector3(1, 0, 0), new THREE.Vector3(-5, 0, 0), new THREE.Vector3(1, 0, 0)), null);
});

test("labels show at most three decimals", () => {
  assert.equal(formatValue(24.28412), "24.284");
  assert.equal(formatValue(10), "10");
});
