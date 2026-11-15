import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { facesUnder, faceIdAt, faceUnder, isGhostTriangle, nearestAxis, nearestCentre, occluded, pick, pickCycling, pickHit, pickModelItem } from "../src/viewpick.ts";
import { settings } from "../src/settings.ts";

// A square 2 x 2 at z=0 (face 7, triangles 0-1) with a second face 8 (triangle 2) far below it, seen from (0,0,10).
// 100 x 100 pixels: one model unit is about 12 pixels near the square.
function viewport(extra = {}) {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0, -1, -1, -3, 1, -1, -3, 1, 1, -3]);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  const material = new THREE.MeshBasicMaterial({ side: THREE.FrontSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.updateMatrixWorld();
  return {
    camera,
    mesh,
    surfaceMaterial: material,
    ghostMaterial: null,
    ghosted: new Set(),
    faceStarts: [0, 2], // in triangles
    data: {
      positions,
      indices,
      faces: [{ id: 7, start: 0, count: 6, body: 1 }, { id: 8, start: 6, count: 3, body: 2 }],
      vertices: [{ id: 1, position: [1, 1, 0] }],
      edges: [{ id: 3, start: 0, count: 2 }],
      edgePositions: new Float32Array([-1, -1, 0, 1, -1, 0]),
      centres: [],
    },
    centresShown: [],
    lastClick: { x: 0, y: 0, n: 0 },
    originAxisHalf: 0,
    probe: null,
    raycaster: new THREE.Raycaster(),
    renderer: { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) } },
    pixelSizeAtDistance: (d, h) => (2 * d * Math.tan((45 * Math.PI) / 360)) / h,
    ...extra,
  };
}
const at = (x, y, extra = {}) => ({ clientX: x, clientY: y, altKey: false, ...extra });

test("a point on the square picks the face and its point", () => {
  const v = viewport();
  const hit = pickHit(v, at(50, 50));
  assert.equal(hit.kind, "face");
  assert.equal(hit.id, 7);
  assert.ok(Math.abs(hit.point.z) < 1e-6);
  assert.deepEqual(pick(v, at(50, 50)), { kind: "face", id: 7 });
  assert.equal(pickHit(v, at(5, 5)), null);
  assert.equal(pickHit({ ...v, mesh: null }, at(50, 50)), null);
});

test("a vertex or an edge near the pointer wins over the face, a vertex first", () => {
  const v = viewport();
  assert.deepEqual(pick(v, at(62, 38)), { kind: "vertex", id: 1 });
  assert.deepEqual(pick(v, at(50, 62)), { kind: "edge", id: 3 });
});

test("the pick ranges follow the settings", () => {
  const v = viewport();
  const saved = settings.edgePickPx;
  settings.edgePickPx = 1;
  assert.deepEqual(pick(v, at(50, 59)), { kind: "face", id: 7 }); // three pixels off the edge
  settings.edgePickPx = saved;
  assert.deepEqual(pick(v, at(50, 59)), { kind: "edge", id: 3 });
});

test("pickModelItem returns only faces and edges", () => {
  const v = viewport();
  assert.equal(pickModelItem(v, at(62, 38)), null); // a vertex is neither
  assert.deepEqual(pickModelItem(v, at(50, 62)), { kind: "edge", id: 3 });
  assert.equal(pickModelItem(v, at(5, 5)), null);
});

test("hole centers pick their face; the global axes pick by number", () => {
  const v = viewport({ centresShown: [{ face: 7, position: [0, 0, 0], axis: [0, 0, 1] }] });
  assert.deepEqual(nearestCentre(v, 52, 50, { width: 100, height: 100 }), { kind: "face", id: 7, point: new THREE.Vector3(0, 0, 0), centre: true });
  assert.equal(nearestCentre(v, 90, 90, { width: 100, height: 100 }), null);
  const axes = viewport({ originAxisHalf: 5 });
  const hit = nearestAxis(axes, 50, 50, { width: 100, height: 100 }, Infinity);
  assert.equal(hit.kind, "axis");
  assert.equal(nearestAxis(viewport(), 50, 50, { width: 100, height: 100 }, Infinity), null); // axes hidden
});

test("faceIdAt and isGhostTriangle read the face tables", () => {
  const v = viewport();
  assert.equal(faceIdAt(v, 0), 7);
  assert.equal(faceIdAt(v, 1), 7);
  assert.equal(faceIdAt(v, 2), 8);
  assert.equal(isGhostTriangle(v, 2), false);
  v.ghosted = new Set([2]);
  assert.equal(isGhostTriangle(v, 2), true);
  assert.equal(isGhostTriangle(v, 0), false);
  assert.equal(isGhostTriangle(v, null), false);
});

test("facesUnder lists every face the ray crosses, nearest first, and restores the material side", () => {
  const v = viewport();
  assert.deepEqual(facesUnder(v, at(54, 56)), [7, 8]);
  assert.equal(v.surfaceMaterial.side, THREE.FrontSide);
  assert.deepEqual(facesUnder(v, at(5, 5)), []);
  assert.equal(faceUnder(v, at(50, 50)).id, 7);
});

test("pickCycling goes to the next face behind on a repeated click when asked to cycle", () => {
  const v = viewport();
  const first = pickCycling(v, at(54, 56, { altKey: true }));
  assert.deepEqual(first, { kind: "face", id: 7 });
  const second = pickCycling(v, at(54, 56, { altKey: true }));
  assert.deepEqual(second, { kind: "face", id: 8 });
  const third = pickCycling(v, at(54, 56, { altKey: true }));
  assert.deepEqual(third, { kind: "face", id: 7 });
  const plain = viewport();
  pickCycling(plain, at(54, 56));
  assert.deepEqual(pickCycling(plain, at(54, 56)), { kind: "face", id: 7 }); // no Alt: no cycling
});

test("a point behind the model is occluded, one in front is not, and see-through shows everything", () => {
  const v = viewport();
  assert.equal(occluded(v, new THREE.Vector3(0, 0, -2)), true);
  assert.equal(occluded(v, new THREE.Vector3(0, 0, 5)), false);
  settings.seeThrough = true;
  try {
    assert.equal(occluded(v, new THREE.Vector3(0, 0, -2)), false);
  } finally {
    settings.seeThrough = false;
  }
  assert.equal(occluded({ ...v, probe: { hidden: () => true } }, new THREE.Vector3(0, 0, 5)), true);
});
