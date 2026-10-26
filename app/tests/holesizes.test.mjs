import test from "node:test";
import assert from "node:assert/strict";
import { holeSizes, hasSizes } from "../src/holesizes.ts";

test("hole tools offer clearance and tap drill sizes", () => {
  const sizes = holeSizes("diameter");
  assert.equal(sizes.find((s) => s.label === "M6 clearance").diameter, 6.6);
  assert.equal(sizes.find((s) => s.label === "M8 tap drill").diameter, 6.8);
  assert.ok(sizes.every((s) => s.diameter > 0));
  assert.equal(holeSizes("bore_diameter").find((s) => s.label.startsWith("M5")).diameter, 10);
  assert.ok(hasSizes("add_hole", "diameter") && !hasSizes("add_hole", "depth") && !hasSizes("push_pull", "distance"));
});
