import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { beginItemDrag, cancelDrag, dragDirection, dragDistance, finishDrag } from "../src/viewitemdrag.ts";

const line = () => ({ visible: false, geometry: { setPositions() {} } });
function viewport(extra = {}) {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, -10, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return {
    camera,
    controls: { enabled: false },
    data: {
      faces: [{ id: 1, start: 0, count: 6, normal: [0, 0, 1] }, { id: 2, start: 0, count: 0 }],
      edges: [{ id: 4, start: 0, count: 2, normal: [1, 0, 0] }],
      centres: [{ face: 2, position: [0, 0, 0], axis: [0, 0, 1] }],
      edgePositions: new Float32Array(6),
    },
    mesh: null,
    drag: null,
    dragReleased: true,
    holdDrag: true,
    lastDistance: 0,
    measureAll: line(),
    measureHot: line(),
    measureHover: null,
    measureMode: true,
    measureSel: null,
    measures: [],
    primaryMeasure: null,
    selected: [{ kind: "face", id: 1 }],
    renderer: { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) } },
    toPixels: () => ({ x: 0, y: 0 }),
    calls: [],
    onItemDrag(...a) { this.calls.push(a); },
    onMeasureChange() {},
    ...extra,
  };
}

test("dragDirection uses the face or edge normal, a wall's pressed normal, or nothing", () => {
  const v = viewport();
  assert.deepEqual(dragDirection(v, { kind: "face", id: 1 }).toArray(), [0, 0, 1]);
  assert.deepEqual(dragDirection(v, { kind: "edge", id: 4 }).toArray(), [1, 0, 0]);
  const wall = new THREE.Vector3(1, 0, 0);
  const got = dragDirection(v, { kind: "face", id: 2, surfaceNormal: wall });
  assert.deepEqual(got.toArray(), [1, 0, 0]);
  assert.notEqual(got, wall); // a copy
  assert.equal(dragDirection(v, { kind: "face", id: 3 }), null);
  assert.equal(dragDirection(v, { kind: "vertex", id: 1 }), null);
});

test("beginItemDrag records the drag from the selection and clears the release flag", () => {
  const v = viewport();
  beginItemDrag(v, { clientX: 4, clientY: 5 }, new THREE.Vector3(0, 0, 1), new THREE.Vector3(), null);
  assert.equal(v.dragReleased, false);
  assert.deepEqual(v.drag.sels, [{ kind: "face", id: 1 }]);
  assert.notEqual(v.drag.sels, v.selected);
  assert.equal(v.drag.x, 4);
  assert.equal(v.drag.moved, false);
  assert.deepEqual(v.measures, []);
  assert.equal(v.primaryMeasure, null);
});

test("dragDistance projects the pointer movement on the drag axis in world units", () => {
  const v = viewport();
  const drag = { normal: new THREE.Vector3(0, 0, 1), point: new THREE.Vector3(), x: 50, y: 50 };
  // Looking along +Y, up on screen is +Z: dragging up by a pixel amount gives a positive distance, down a negative one.
  const up = dragDistance(v, { clientX: 50, clientY: 30 }, drag);
  const down = dragDistance(v, { clientX: 50, clientY: 70 }, drag);
  assert.ok(up > 0);
  assert.ok(Math.abs(up + down) < 1e-9);
  assert.equal(dragDistance(v, { clientX: 90, clientY: 50 }, drag), 0); // sideways: no change
  // Looking along the normal itself: dragging up still counts as outward.
  const along = { normal: new THREE.Vector3(0, -1, 0), point: new THREE.Vector3(), x: 50, y: 50 };
  assert.ok(dragDistance(v, { clientX: 50, clientY: 30 }, along) > 0);
});

test("cancelDrag and finishDrag end the drag and tell the owner of the drag", () => {
  const v = viewport();
  v.drag = { sels: [{ kind: "face", id: 1 }], normal: new THREE.Vector3(0, 0, 1) };
  cancelDrag(v);
  assert.equal(v.drag, null);
  assert.equal(v.holdDrag, false);
  assert.equal(v.controls.enabled, true);
  assert.equal(v.measureMode, false);
  assert.deepEqual(v.calls[0].slice(1), [0, "cancel"]);
  cancelDrag(v); // nothing to cancel
  assert.equal(v.calls.length, 1);
  const w = viewport();
  w.drag = { sels: [{ kind: "face", id: 1 }], normal: new THREE.Vector3(0, 0, 1) };
  w.measureSel = { kind: "chosen" };
  w.onItemDrag = function (...a) {
    this.calls.push([...a, this.measureSel]); // the measure choice is still there when the end is reported
  };
  finishDrag(w);
  assert.deepEqual(w.calls[0].slice(1), [0, "end", { kind: "chosen" }]);
  assert.equal(w.measureSel, null);
  assert.equal(w.drag, null);
  finishDrag(w);
  assert.equal(w.calls.length, 1);
});
