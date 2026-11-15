import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { drawMeasures, endMeasure, findMeasures, nearestMeasure, toggleMeasure, toggleMeasureKey } from "../src/viewdragmeasure.ts";

let lastPositions = null;
const line = () => ({ visible: false, geometry: { setPositions(p) { lastPositions = p; } } });

// Face 1 is the unit square at z=1. Edge 0 runs from (0,0,0) up to (0,0,1): one end on the face.
function viewport(extra = {}) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]), 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 1, 2, 0, 2, 3]), 1));
  const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.updateMatrixWorld();
  return {
    mesh: new THREE.Mesh(geometry),
    data: {
      faces: [{ id: 1, start: 0, count: 6 }],
      edges: [
        { start: 0, count: 2 }, // vertical, one end on the face
        { start: 2, count: 2 }, // horizontal along the face: ignored
        { start: 4, count: 2 }, // vertical, but its end on the plane is outside the face
      ],
      edgePositions: new Float32Array([0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 5, 5, 0, 5, 5, 1]),
    },
    drag: { normal: new THREE.Vector3(0, 0, 1), moved: false, x: 3, y: 4, sels: [{ kind: "face", id: 1 }] },
    holdDrag: false,
    lastDistance: 0,
    measureAll: line(),
    measureHot: line(),
    measureHover: null,
    measureMode: false,
    measureSel: null,
    measures: [],
    primaryMeasure: null,
    camera,
    renderer: { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) } },
    toPixels: (p) => ({ x: ((p.x + 5) / 10) * 100, y: ((5 - p.y) / 10) * 100 }),
    changes: 0,
    onMeasureChange() { this.changes++; },
    itemDrags: [],
    onItemDrag(...a) { this.itemDrags.push(a); },
    ...extra,
  };
}
const normal = new THREE.Vector3(0, 0, 1);
const measuresOf = (v) => findMeasures(v, { kind: "face", id: 1 }, normal, new THREE.Vector3(0, 0, 1));

test("findMeasures lists the edges that run along the normal with one end on the face", () => {
  const v = viewport();
  const found = measuresOf(v);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].anchor.toArray(), [0, 0, 1]);
  assert.deepEqual(found[0].fixed.toArray(), [0, 0, 0]);
  assert.equal(found[0].length, 1);
  assert.equal(found[0].grow, 1); // the other end is below the face: pulling out lengthens it
  assert.deepEqual(findMeasures(v, { kind: "body", id: 1 }, normal, new THREE.Vector3(0, 0, 1)), []);
});

test("toggleMeasureKey explains why it cannot start, and starts the drag when pressed early", () => {
  assert.match(toggleMeasureKey(viewport({ drag: null })), /press and hold a face/);
  assert.match(toggleMeasureKey(viewport()), /Nothing to measure/);
  const ready = viewport();
  ready.measures = measuresOf(ready);
  assert.equal(toggleMeasureKey(ready), null);
  assert.equal(ready.drag.moved, true);
  assert.deepEqual(ready.itemDrags[0], [ready.drag.sels, 0, "move", 3, 4]);
  assert.equal(ready.measureMode, true);
  assert.equal(ready.holdDrag, true);
  assert.equal(ready.measureSel, ready.measures[0]);
  assert.equal(ready.changes, 1);
  assert.equal(ready.measureAll.visible, true);
});

test("toggling off releases the hold, and endMeasure clears everything", () => {
  const v = viewport();
  v.measures = measuresOf(v);
  toggleMeasure(v);
  toggleMeasure(v);
  assert.equal(v.measureMode, false);
  assert.equal(v.holdDrag, false);
  assert.equal(v.measureAll.visible, false);
  toggleMeasure(v);
  endMeasure(v);
  assert.equal(v.measureMode, false);
  assert.deepEqual(v.measures, []);
  assert.equal(v.measureSel, null);
  assert.equal(v.measureHot.visible, false);
});

test("drawMeasures moves the anchor ends by the drag distance", () => {
  const v = viewport();
  v.measures = measuresOf(v);
  v.measureMode = true;
  drawMeasures(v, 2);
  assert.equal(v.lastDistance, 2);
  assert.deepEqual([...lastPositions], [0, 0, 0, 0, 0, 3]);
});

test("nearestMeasure picks the edge within 10 pixels of the pointer", () => {
  const v = viewport();
  v.measures = measuresOf(v);
  assert.equal(nearestMeasure(v, { clientX: 54, clientY: 50 }), v.measures[0]);
  assert.equal(nearestMeasure(v, { clientX: 80, clientY: 50 }), null);
  assert.equal(nearestMeasure({ ...v, drag: null }, { clientX: 50, clientY: 50 }), null);
});
