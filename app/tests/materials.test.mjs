import test from "node:test";
import assert from "node:assert/strict";
import { MATERIALS, defaultMaterial, getMaterial, materialOrDefault, usesBodyColors } from "../src/materials.ts";

const rough = (id) => getMaterial(id).render.roughness;

test("the default material exists in the registry", () => {
  const m = defaultMaterial();
  assert.ok(m && getMaterial(m.id) === m);
  assert.equal(materialOrDefault("nonsense"), m);
});

test("every material has a positive density and render values in range", () => {
  const ids = new Set();
  for (const m of MATERIALS) {
    assert.ok(!ids.has(m.id), "unique id");
    ids.add(m.id);
    assert.ok(m.name.length > 0 && ["Plastic", "Resin", "Metal"].includes(m.group));
    assert.ok(m.density > 0);
    assert.ok(m.render.color >= 0 && m.render.color <= 0xffffff);
    for (const k of ["roughness", "metalness", "clearcoat", "clearcoatRoughness"]) assert.ok(m.render[k] >= 0 && m.render[k] <= 1, `${m.id}.${k}`);
    assert.ok(m.render.envMapIntensity >= 0 && m.render.envMapIntensity <= 2);
  }
});

test("the requested materials exist", () => {
  for (const id of ["pla", "petg", "abs", "asa", "resin-standard", "resin-tough", "steel", "stainless", "aluminium", "copper", "gold", "silver", "titanium", "cobalt"]) assert.ok(getMaterial(id), id);
  assert.equal(getMaterial("abs").density, 1050);
  assert.equal(getMaterial("gold").density, 19320);
});

test("metals have metalness 1 and no clearcoat, plastics and resins 0", () => {
  for (const m of MATERIALS) {
    if (m.group === "Metal") {
      assert.equal(m.render.metalness, 1);
      assert.equal(m.render.clearcoat, 0);
      assert.equal(usesBodyColors(m), false);
    } else {
      assert.equal(m.render.metalness, 0);
      assert.equal(usesBodyColors(m), true);
    }
  }
});

test("lustre order: silver and gold are the smoothest, titanium the dullest", () => {
  assert.ok(rough("silver") <= rough("gold"));
  assert.ok(rough("gold") < rough("copper"));
  assert.ok(rough("copper") < rough("aluminium"));
  assert.ok(rough("aluminium") < rough("steel"));
  assert.ok(rough("steel") < rough("titanium"));
  assert.ok(rough("cobalt") < rough("steel"));
  assert.ok(rough("petg") < rough("abs") && rough("abs") <= rough("asa"));
  assert.ok(rough("resin-standard") < rough("petg"));
});
