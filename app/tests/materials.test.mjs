import test from "node:test";
import assert from "node:assert/strict";
import { MATERIALS, defaultMaterial, getMaterial } from "../src/materials.ts";

test("the default material exists in the registry", () => {
  const m = defaultMaterial();
  assert.ok(m && getMaterial(m.id) === m);
});

test("every material has a positive density and render values in 0..1", () => {
  const ids = new Set();
  for (const m of MATERIALS) {
    assert.ok(!ids.has(m.id), "unique id");
    ids.add(m.id);
    assert.ok(m.name.length > 0);
    assert.ok(m.density > 0);
    for (const [k, v] of Object.entries(m.render)) assert.ok(v >= 0 && v <= 1, `${m.id}.${k}=${v}`);
  }
});
