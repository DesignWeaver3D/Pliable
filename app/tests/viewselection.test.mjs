import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { Mark } from "../src/viewportmark.ts";
import { bodyOf, circleCentre, clickSelect, isSelected, refreshCentres, selectItems, setHover, setRelated, showMark } from "../src/viewselection.ts";

function viewport(extra = {}) {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 5, 1, 0, 5, 1, 1, 5]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6]), 1));
  // A circular edge of radius 2 around the Z axis at z=3, as eight segment ends in order.
  const ring = [];
  for (let i = 0; i < 4; i++) ring.push(2 * Math.cos((i * Math.PI) / 2), 2 * Math.sin((i * Math.PI) / 2), 3);
  const style = { cursor: "" };
  return {
    mesh: new THREE.Mesh(geometry),
    data: {
      faces: [{ id: 1, start: 0, count: 6, body: 10 }, { id: 2, start: 6, count: 3, body: 11 }],
      edges: [{ id: 5, start: 0, count: 2, body: 10 }, { id: 6, start: 2, count: 4, body: 10 }],
      edgePositions: new Float32Array([0, 0, 0, 1, 0, 0, ...ring]),
      vertices: [{ id: 9, position: [1, 1, 0], body: 11 }],
      centres: [{ face: 1, position: [0, 0, 0], axis: [0, 0, 1] }],
    },
    model: new THREE.Group(),
    markSource: geometry,
    hoverLine: new LineMaterial(),
    selectedLine: new LineMaterial(),
    hoverMark: null,
    relatedMarks: [],
    selectedMarks: [],
    centreDots: null,
    centresShown: [],
    originAxisHalf: 0,
    hovered: null,
    selected: [],
    hoverBodies: [],
    selections: [],
    onHoverBody(id) { this.hoverBodies.push(id); },
    onSelect(list) { this.selections.push(list); },
    renderer: { domElement: { style } },
    ...extra,
  };
}
const markFor = (v) => new Mark(v.model, v.markSource, 0xff0000, 1, v.hoverLine);

test("bodyOf finds the body of any kind of item", () => {
  const v = viewport();
  assert.equal(bodyOf(v, { kind: "body", id: 3 }), 3);
  assert.equal(bodyOf(v, { kind: "face", id: 2 }), 11);
  assert.equal(bodyOf(v, { kind: "edge", id: 5 }), 10);
  assert.equal(bodyOf(v, { kind: "vertex", id: 9 }), 11);
  assert.equal(bodyOf(v, { kind: "face", id: 99 }), null);
  assert.equal(bodyOf(v, null), null);
});

test("showMark highlights the right part for each kind", () => {
  const v = viewport();
  const m = markFor(v);
  showMark(v, m, { kind: "face", id: 1 });
  assert.equal(m.face.visible, true);
  assert.equal(m.face.geometry.getAttribute("position").count, 6);
  showMark(v, m, { kind: "body", id: 10 });
  assert.equal(m.face.geometry.getAttribute("position").count, 6);
  assert.equal(m.edge.visible, true);
  showMark(v, m, { kind: "vertex", id: 9 });
  assert.equal(m.vertex.visible, true);
  assert.equal(m.face.visible, false);
  showMark(v, m, { kind: "edge", id: 5 });
  assert.equal(m.edge.visible, true);
  showMark(v, m, { kind: "face", id: 1, centre: true });
  assert.equal(m.vertex.visible, true);
  assert.equal(m.edge.visible, false);
  showMark(v, m, { kind: "face", id: 99 });
  assert.equal(m.face.visible, false);
  showMark(v, m, null);
  assert.equal(m.vertex.visible, false);
});

test("an axis mark needs the axes drawn", () => {
  const v = viewport();
  const m = markFor(v);
  showMark(v, m, { kind: "axis", id: 2 });
  assert.equal(m.edge.visible, false);
  v.originAxisHalf = 4;
  showMark(v, m, { kind: "axis", id: 2 });
  assert.equal(m.edge.visible, true);
});

test("circleCentre finds the hole center for a circular edge", () => {
  const v = viewport();
  assert.equal(circleCentre(v, 5), null); // too short to be a circle
  const c = circleCentre(v, 6);
  assert.equal(c.face, 1);
  assert.ok(Math.abs(c.position[2] - 3) < 1e-6);
  assert.equal(circleCentre(v, 99), null);
});

test("center dots show for hovered or selected holes and circular edges only", () => {
  const v = viewport();
  v.hovered = { kind: "face", id: 1 };
  refreshCentres(v);
  assert.equal(v.centresShown.length, 1);
  v.hovered = null;
  v.selected = [{ kind: "edge", id: 6 }, { kind: "edge", id: 5 }];
  refreshCentres(v);
  assert.equal(v.centresShown.length, 1);
  assert.equal(v.centresShown[0].face, 1);
  v.selected = [{ kind: "face", id: 2 }];
  refreshCentres(v);
  assert.deepEqual(v.centresShown, []);
});

test("setHover reports the body once, sets the cursor and ignores a repeat", () => {
  const v = viewport();
  setHover(v, { kind: "face", id: 2 });
  assert.deepEqual(v.hoverBodies, [11]);
  assert.equal(v.renderer.domElement.style.cursor, "pointer");
  setHover(v, { kind: "face", id: 2 });
  assert.equal(v.hoverBodies.length, 1);
  setHover(v, { kind: "face", id: 2, centre: true }); // the center dot of the same face is a different hover
  assert.equal(v.hoverBodies.length, 2);
  setHover(v, null);
  assert.equal(v.renderer.domElement.style.cursor, "");
  assert.equal(v.hoverBodies.at(-1), null);
});

test("selectItems marks without notifying; clickSelect notifies", () => {
  const v = viewport();
  selectItems(v, [{ kind: "face", id: 1 }, { kind: "face", id: 2 }]);
  assert.equal(v.selectedMarks.length, 2);
  assert.equal(v.selectedMarks[1].face.visible, true);
  assert.equal(v.selections.length, 0);
  assert.equal(isSelected(v, { kind: "face", id: 2 }), true);
  assert.equal(isSelected(v, { kind: "edge", id: 2 }), false);
});

test("a plain click replaces the selection, Ctrl+click toggles, mixed kinds restart", () => {
  const v = viewport();
  clickSelect(v, { kind: "face", id: 1 }, false);
  assert.deepEqual(v.selected, [{ kind: "face", id: 1 }]);
  clickSelect(v, { kind: "face", id: 2 }, true);
  assert.equal(v.selected.length, 2);
  clickSelect(v, { kind: "face", id: 1 }, true);
  assert.deepEqual(v.selected, [{ kind: "face", id: 2 }]);
  clickSelect(v, null, true); // Ctrl+click on nothing keeps the selection
  assert.equal(v.selected.length, 1);
  clickSelect(v, { kind: "vertex", id: 9 }, true); // a vertex cannot join faces
  assert.deepEqual(v.selected, [{ kind: "vertex", id: 9 }]);
  clickSelect(v, null, false);
  assert.deepEqual(v.selected, []);
  assert.equal(v.selections.length, 6);
});

test("setRelated shows the faint marks and hides the extra ones", () => {
  const v = viewport();
  setRelated(v, [{ kind: "face", id: 1 }, { kind: "face", id: 2 }]);
  assert.equal(v.relatedMarks.length, 2);
  setRelated(v, [{ kind: "face", id: 2 }]);
  assert.equal(v.relatedMarks[0].face.visible, true);
  assert.equal(v.relatedMarks[1].face.visible, false);
});
