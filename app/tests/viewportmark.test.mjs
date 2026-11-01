import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { Mark } from "../src/viewportmark.ts";

function source() {
  return new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3));
}

test("a mark adds its face, edge and vertex parts to the parent, hidden and drawn over the model", () => {
  const parent = new THREE.Group();
  const line = new LineMaterial();
  const geometry = source();
  const mark = new Mark(parent, geometry, 0xff8a1f, 0.85, line);
  assert.deepEqual(parent.children, [mark.face, mark.edge, mark.vertex]);
  for (const part of [mark.face, mark.edge, mark.vertex]) {
    assert.equal(part.visible, false);
    assert.equal(part.renderOrder, 2);
  }
  assert.equal(mark.face.material.opacity, 0.85);
  assert.equal(mark.face.geometry.getAttribute("position"), geometry.getAttribute("position"));
  assert.equal(mark.face.geometry.index.count, 0);
  assert.equal(mark.edge.material, line);
});

test("hide turns every part of the mark off", () => {
  const mark = new Mark(new THREE.Group(), source(), 0xffd36b, 0.55, new LineMaterial());
  mark.face.visible = mark.edge.visible = mark.vertex.visible = true;
  mark.hide();
  assert.deepEqual([mark.face.visible, mark.edge.visible, mark.vertex.visible], [false, false, false]);
});
