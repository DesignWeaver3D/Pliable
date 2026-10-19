// Run with: node --test app/tests
import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { Manipulator, linkedValues, axisColorOf, handleColors, formatValue, handleValue, lineParam, travelFor, typedTravel, typedStep } from "../src/manipulator.ts";

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

test("move arrows take the origin-axis colour of their direction and resize grips are neutral", async () => {
  const { AXIS_COLORS } = await import("../src/axes.ts");
  assert.equal(axisColorOf([1, 0, 0]), AXIS_COLORS.x);
  assert.equal(axisColorOf([0, -1, 0]), AXIS_COLORS.y);
  assert.equal(axisColorOf([0.1, 0.2, 0.9]), AXIS_COLORS.z);
  assert.equal(handleColors({ kind: "move", toggle: false, direction: [0, 0, 1] }).rest, AXIS_COLORS.z);
  const resize = handleColors({ kind: "resize", toggle: false, direction: [1, 0, 0] });
  assert.notEqual(resize.rest, AXIS_COLORS.x);
  assert.notEqual(resize.hot, handleColors({ kind: "arrow", toggle: false, direction: [1, 0, 0] }).hot);
});

test("a low face handle moves the origin the opposite way so the far face stays put", () => {
  // box x = 2, width = 10: the low X face handle points to -x; dragging it 3 units outward gives width 13 and x -1
  const low = { value: 10, scale: 1, min: 0.001, links: [{ param: "x", scale: -1, value: 2 }] };
  assert.equal(handleValue(low, 3), 13);
  assert.deepEqual(linkedValues(low, 3), { x: -1 });
  assert.deepEqual(linkedValues({}, 3), {});
  // the far face (x + width) is unchanged: 2 + 10 = -1 + 13
});

test("a clamped size keeps the linked origin consistent", () => {
  const low = { value: 10, scale: 1, min: 1, links: [{ param: "x", scale: -1, value: 2 }] };
  const travel = travelFor(low, handleValue(low, -50)); // clamps at width 1, travel -9
  assert.deepEqual(linkedValues(low, travel), { x: 11 });
});

test("a typed number is the size for a resize grip, in either direction of its scale", () => {
  const grip = { kind: "resize", value: 10, scale: 1, min: 0.1 };
  assert.equal(handleValue(grip, typedTravel(grip, "25", false)), 25);
  const low = { ...grip, scale: -1 }; // a low face grows the size by moving the other way
  assert.equal(typedTravel(low, "25", false), -15);
  assert.equal(handleValue(low, typedTravel(low, "25", false)), 25);
  assert.equal(handleValue(grip, typedTravel(grip, "4", true)), 0.1); // never below the minimum
  assert.equal(handleValue(grip, typedTravel(grip, "2.5", false)), 2.5);
});

test("a typed number is the distance along the axis for a move arrow, negative going back", () => {
  const arrow = { kind: "move", value: 3, scale: 1, min: null };
  assert.equal(typedTravel(arrow, "10", false), 10);
  assert.equal(typedTravel(arrow, "10", true), -10);
  assert.equal(handleValue(arrow, typedTravel(arrow, "10", true)), -7);
});

test("a typed number is the value of a radius or distance handle", () => {
  const fillet = { kind: "arrow", value: 1, scale: 1, min: 0.01, max: 50 };
  assert.equal(handleValue(fillet, typedTravel(fillet, "3", false)), 3);
  assert.equal(handleValue(fillet, typedTravel(fillet, "99", false)), 50);
});

test("nothing usable typed gives no travel, and entry keys build the text", () => {
  const grip = { kind: "resize", value: 10, scale: 1, min: 0.1 };
  assert.equal(typedTravel(grip, "", false), null);
  assert.equal(typedTravel(grip, ".", false), null);
  let st = typedStep(null, false, "2");
  st = typedStep(st.text, st.negative, "5");
  assert.deepEqual(st, { text: "25", negative: false });
  assert.deepEqual(typedStep("25", false, "-"), { text: "25", negative: true });
  assert.deepEqual(typedStep("25", true, "-"), { text: "25", negative: false });
  assert.equal(typedStep("2.5", false, "."), null);
  assert.deepEqual(typedStep("25", false, "Backspace"), { text: "2", negative: false });
  assert.equal(typedStep(null, false, "Backspace"), null);
  assert.equal(typedStep(null, false, "Tab"), null);
});

test("typing a handle value changes nothing until Enter applies it", () => {
  const info = { param: "w", value: 10, scale: 1, min: 1, kind: "resize", direction: [1, 0, 0], anchor: [0, 0, 0] };
  const m = Object.create(Manipulator.prototype);
  const seen = [];
  m.onDrag = (param, value, phase) => seen.push([param, value, phase]);
  m.dom = { style: {} };
  m.active = { item: { info, travel: 0 }, travel0: 0, moved: false, typed: null, negative: false, x: 0, y: 0 };
  assert.equal(m.key({ key: "5" }), true);
  assert.equal(m.key({ key: "0" }), true);
  assert.deepEqual(seen, []); // nothing applied while typing
  assert.equal(m.active.item.travel, 0);
  m.key({ key: "Enter" });
  assert.deepEqual(seen, [["w", 50, "move"], ["w", 50, "end"]]);
});

test("Escape while typing a handle value restores the start without applying", () => {
  const info = { param: "w", value: 10, scale: 1, min: 1, kind: "resize", direction: [1, 0, 0], anchor: [0, 0, 0] };
  const m = Object.create(Manipulator.prototype);
  const seen = [];
  m.onDrag = (param, value, phase) => seen.push(phase);
  m.dom = { style: {} };
  m.active = { item: { info, travel: 0 }, travel0: 0, moved: false, typed: null, negative: false, x: 0, y: 0 };
  m.key({ key: "5" });
  m.key({ key: "Escape" });
  assert.deepEqual(seen, []);
});
