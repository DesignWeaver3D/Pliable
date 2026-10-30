import test from "node:test";
import assert from "node:assert/strict";
import { FASTENERS, fastenerNamed, fastenersOf, defaultClearance } from "../src/holepresets.ts";

test("every preset is a sensible fastener hole", () => {
  assert.ok(fastenersOf("metric").length >= 12 && fastenersOf("inch").length >= 10);
  for (const f of FASTENERS) {
    assert.ok(f.tap > 0 && f.tap < f.major, `${f.name} tap drill is under the major diameter`);
    assert.ok(f.clearance.length >= 2 && f.clearance.every((c) => c.diameter > f.major), `${f.name} clearance is over the major diameter`);
    const sorted = f.clearance.map((c) => c.diameter);
    assert.deepEqual(sorted, [...sorted].sort((a, b) => a - b), `${f.name} clearance classes grow`);
    if (f.counterbore) assert.ok(f.counterbore.diameter > defaultClearance(f).diameter && f.counterbore.depth > 0);
    if (f.countersink) assert.ok(f.countersink.diameter > f.major && [82, 90].includes(f.countersink.angle));
  }
});

test("known values", () => {
  const m6 = fastenerNamed("M6");
  assert.equal(defaultClearance(m6).diameter, 6.6);
  assert.equal(m6.tap, 5);
  assert.deepEqual(m6.counterbore, { diameter: 11, depth: 6 });
  const quarter = fastenerNamed("1/4-20");
  assert.equal(quarter.pitch, 1.27);
  assert.equal(quarter.major, 6.35);
  assert.equal(quarter.countersink.angle, 82);
});

test("metric clearance series and 90 degree countersinks match the published tables", () => {
  const clearance = { M2: [2.2, 2.4, 2.6], "M2.5": [2.7, 2.9, 3.1], M3: [3.2, 3.4, 3.6], M4: [4.3, 4.5, 4.8], M5: [5.3, 5.5, 5.8], M6: [6.4, 6.6, 7], M8: [8.4, 9, 10], M10: [10.5, 11, 12], M12: [13, 13.5, 14.5], M14: [15, 15.5, 16.5], M16: [17, 17.5, 18.5], M20: [21, 22, 24], M24: [25, 26, 28] };
  for (const [name, series] of Object.entries(clearance)) assert.deepEqual(fastenerNamed(name).clearance.map((c) => c.diameter), series, name);
  const sinks = { M3: 6.7, M4: 9, M5: 11.2, M6: 13.4, M8: 17.9, M10: 22.4, M12: 26.9, M14: 30.8, M16: 33.6, M20: 40.3 };
  for (const [name, d] of Object.entries(sinks)) assert.ok(Math.abs(fastenerNamed(name).countersink.diameter - d) < 0.1, name);
});
