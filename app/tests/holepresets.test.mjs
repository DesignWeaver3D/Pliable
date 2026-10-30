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
