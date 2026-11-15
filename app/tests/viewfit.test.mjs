import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { fitAll, fitPoints, fitSelected, frame } from "../src/viewfit.ts";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const HALF = Math.tan((45 * Math.PI) / 360);

// A cube mesh 0..2 as two faces of two triangles each.
function cube() {
  const p = [];
  for (const z of [0, 2]) for (const y of [0, 2]) for (const x of [0, 2]) p.push(x, y, z);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(p), 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 1, 3, 0, 3, 2, 4, 5, 7, 4, 7, 6]), 1));
  return new THREE.Mesh(geometry);
}
function viewport(extra = {}) {
  const perspectiveCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  perspectiveCamera.position.set(0, -10, 0);
  return {
    aspect: 1,
    camera: perspectiveCamera,
    perspectiveCamera,
    orthoCamera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000),
    controls: { target: new THREE.Vector3(), updates: 0, update() { this.updates++; } },
    renderer: { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) } },
    orthoHalf: 1,
    fitSource: null,
    fitInsets: undefined,
    selected: [],
    mesh: cube(),
    data: {
      faces: [{ id: 1, start: 0, count: 6, body: 1 }, { id: 2, start: 6, count: 6, body: 2 }],
      edges: [{ id: 5, start: 0, count: 2, body: 1 }],
      edgePositions: new Float32Array([0, 0, 0, 2, 0, 0]),
      vertices: [{ id: 9, position: [0.5, 0.5, 0.5] }],
    },
    ...extra,
  };
}

test("frame puts the box center at the target and sizes the view to its radius", () => {
  const v = viewport();
  frame(v, [0, 0, 0, 2, 2, 2]);
  const radius = Math.hypot(2, 2, 2) / 2;
  near(v.controls.target.x, 1);
  near(v.controls.target.z, 1);
  const distance = v.camera.position.distanceTo(v.controls.target);
  near(distance, radius / Math.sin((45 * Math.PI) / 360), 1e-4);
  near(v.orthoHalf, distance * HALF, 1e-4);
  near(v.camera.far, distance * 100, 1e-3);
  assert.equal(v.controls.updates, 1);
});

test("frame can keep the viewing direction", () => {
  const v = viewport();
  frame(v, [0, 0, 0, 1, 1, 1], true);
  const dir = v.camera.position.clone().sub(v.controls.target).normalize();
  near(dir.y, -1, 1e-6); // the camera was on the -Y side
});

test("frame inside the free area moves the view away and shifts the focus", () => {
  const plain = viewport();
  frame(plain, [0, 0, 0, 2, 2, 2], true, true);
  const shifted = viewport({ fitInsets: () => ({ top: 0, right: 0, bottom: 0, left: 300 }) });
  frame(shifted, [0, 0, 0, 2, 2, 2], true, true);
  assert.ok(shifted.camera.position.distanceTo(shifted.controls.target) > plain.camera.position.distanceTo(plain.controls.target));
  assert.ok(Math.abs(shifted.controls.target.x - plain.controls.target.x) > 0.01);
});

test("fitAll frames the mesh's bounding box, or the sketch when a sketch is open", () => {
  const v = viewport();
  fitAll(v);
  near(v.controls.target.x, 1);
  const sketch = viewport({ fitSource: { all: () => [[10, 0, 0], [12, 0, 0]], selected: () => null, pad: 0 } });
  fitAll(sketch);
  near(sketch.controls.target.x, 11);
  const empty = viewport({ mesh: null });
  fitAll(empty);
  assert.equal(empty.controls.updates, 0);
});

test("fitPoints zooms to a lone point", () => {
  const v = viewport();
  fitPoints(v, [[5, 5, 5]]);
  near(v.controls.target.x, 5);
  assert.ok(v.camera.position.distanceTo(v.controls.target) > 0);
});

test("fitSelected needs a selection and zooms to a body, face or vertex", () => {
  const v = viewport();
  assert.equal(fitSelected(v), false);
  v.selected = [{ kind: "body", id: 1 }];
  assert.equal(fitSelected(v), true);
  assert.ok(v.controls.target.x > 0.5 && v.controls.target.x < 1.5);
  assert.equal(fitSelected(viewport({ selected: [{ kind: "face", id: 2 }] })), true);
  assert.equal(fitSelected(viewport({ selected: [{ kind: "face", id: 77 }] })), false);
  const vertex = viewport({ selected: [{ kind: "vertex", id: 9 }] });
  assert.equal(fitSelected(vertex), true);
  assert.ok(vertex.camera.position.distanceTo(vertex.controls.target) > 0.1); // a minimum size around a lone vertex
});

test("with a sketch open, fitSelected asks the sketch", () => {
  const v = viewport({ fitSource: { all: () => null, selected: () => [[0, 0, 0], [4, 0, 0]], pad: 0 } });
  assert.equal(fitSelected(v), true);
  near(v.controls.target.x, 2);
  const none = viewport({ fitSource: { all: () => null, selected: () => null, pad: 0 } });
  assert.equal(fitSelected(none), false);
});
