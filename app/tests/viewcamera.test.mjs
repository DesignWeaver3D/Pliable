import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { STANDARD_VIEWS, alignToFace, fitClipping, lookFrom, returnFromSketchView, setOrthographic, setView, syncOrtho, viewMatrixCss } from "../src/viewcamera.ts";
import { averageFaceDirection, wrapAxis } from "../src/viewfacedir.ts";

// A stand-in for the viewport: real cameras and a controls object that only counts updates.
function viewport(extra = {}) {
  const perspectiveCamera = new THREE.PerspectiveCamera(45, 2, 0.1, 1000);
  perspectiveCamera.position.set(0, -10, 0);
  const view = {
    aspect: 2,
    perspectiveCamera,
    orthoCamera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000),
    camera: perspectiveCamera,
    controls: { target: new THREE.Vector3(), updates: 0, object: perspectiveCamera, update() { this.updates++; } },
    scene: new THREE.Scene(),
    keyLight: new THREE.DirectionalLight(),
    orthoHalf: 5,
    orthographic: false,
    lastClip: 0,
    sketchViewReturn: null,
    data: null,
    mesh: null,
    projectionChanges: 0,
    onProjectionChange() { this.projectionChanges++; },
    ...extra,
  };
  Object.defineProperty(view, "orthographic", { get() { return this.camera === this.orthoCamera; } });
  view.scene.add(perspectiveCamera);
  perspectiveCamera.add(view.keyLight);
  return view;
}
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test("syncOrtho sizes the frustum to the aspect ratio", () => {
  const v = viewport();
  syncOrtho(v);
  assert.equal(v.orthoCamera.top, 5);
  assert.equal(v.orthoCamera.bottom, -5);
  assert.equal(v.orthoCamera.right, 10);
  assert.equal(v.orthoCamera.left, -10);
});

test("setView and lookFrom keep the target and the distance", () => {
  const v = viewport();
  setView(v, "right");
  near(v.camera.position.x, 10);
  near(v.camera.position.y, 0);
  setView(v, "nonsense");
  near(v.camera.position.x, 10);
  lookFrom(v, new THREE.Vector3(0, 0, 3)); // straight down is nudged so up stays defined
  near(v.camera.position.distanceTo(v.controls.target), 10);
  assert.ok(v.camera.position.y < 0);
  assert.equal(v.controls.updates, 2);
  assert.equal(Object.keys(STANDARD_VIEWS).length, 7);
});

test("switching to orthographic keeps the framed size, and back again restores the distance", () => {
  const v = viewport();
  v.sketchViewReturn = new THREE.Vector3(0, 1, 0);
  setOrthographic(v, true);
  assert.equal(v.camera, v.orthoCamera);
  assert.equal(v.sketchViewReturn, null);
  near(v.orthoHalf, 10 * Math.tan((45 * Math.PI) / 360));
  assert.equal(v.keyLight.parent, v.orthoCamera);
  assert.equal(v.scene.children.includes(v.orthoCamera), true);
  assert.equal(v.scene.children.includes(v.perspectiveCamera), false);
  assert.equal(v.projectionChanges, 1);
  setOrthographic(v, true); // already there: nothing happens
  assert.equal(v.projectionChanges, 1);
  setOrthographic(v, false);
  assert.equal(v.camera, v.perspectiveCamera);
  near(v.perspectiveCamera.position.distanceTo(v.controls.target), 10, 1e-4);
});

test("turning away from a sketch view returns to perspective, zooming does not", () => {
  const v = viewport();
  setOrthographic(v, true);
  v.sketchViewReturn = v.camera.position.clone().normalize();
  returnFromSketchView(v);
  assert.equal(v.camera, v.orthoCamera);
  v.camera.position.set(0, 0, 10);
  returnFromSketchView(v);
  assert.equal(v.camera, v.perspectiveCamera);
});

test("clipping planes follow the distance and skip small changes", () => {
  const v = viewport();
  fitClipping(v);
  near(v.camera.near, 0.1);
  near(v.camera.far, 1000);
  v.camera.position.set(0, -10.05, 0);
  fitClipping(v);
  near(v.camera.far, 1000); // under 1 percent: unchanged
  fitClipping(v, true);
  near(v.camera.far, 1005, 1e-6);
});

test("viewMatrixCss gives the identity-like matrix looking along +Y", () => {
  const v = viewport();
  v.camera.lookAt(0, 0, 0);
  const css = viewMatrixCss(v);
  assert.match(css, /^matrix3d\((-?[\d.e-]+,){15}-?[\d.e-]+\)$/);
});

// A flat square face in the XY plane (normal +Z) and a half cylinder.
function meshOf(positions, index) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(index), 1));
  return new THREE.Mesh(geometry);
}
const square = [0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 2, 0];

test("alignToFace uses the face's normal or the mean of its triangles", () => {
  const mesh = meshOf(square, [0, 1, 2, 0, 2, 3]);
  const v = viewport({ mesh, data: { faces: [{ id: 1, start: 0, count: 6, normal: [1, 0, 0] }, { id: 2, start: 0, count: 6 }] } });
  assert.equal(alignToFace(v, 99), false);
  assert.equal(alignToFace(v, 1), true);
  near(v.camera.position.x, 10);
  assert.equal(alignToFace(v, 2), true);
  near(v.camera.position.distanceTo(v.controls.target), 10);
  assert.ok(v.camera.position.z > 9.9);
});

test("a wrapped cylinder face gets its axis, from the camera's side", () => {
  // A square tube around Z: four side quads, normals +-X, +-Y.
  const p = [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0, -1, -1, 4, 1, -1, 4, 1, 1, 4, -1, 1, 4];
  const idx = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    idx.push(i, j, j + 4, i, j + 4, i + 4);
  }
  const mesh = meshOf(p, idx);
  const v = viewport({ mesh });
  v.camera.position.set(0, 0, -10);
  const axis = averageFaceDirection(v, { start: 0, count: idx.length });
  near(Math.abs(axis.z), 1, 1e-5);
  assert.ok(axis.z < 0); // the camera is below
  assert.ok(wrapAxis(v, { start: 0, count: idx.length }));
  assert.equal(wrapAxis(v, { start: 0, count: 0 }), null);
  assert.equal(averageFaceDirection({ ...v, mesh: null }, { start: 0, count: 6 }), null);
});
