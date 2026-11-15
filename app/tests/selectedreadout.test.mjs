import test from "node:test";
import assert from "node:assert/strict";
import { sketchSelectionText } from "../src/selectedreadout.ts";

const s = {
  plane: { origin: [0, 0, 0], normal: [0, 0, 1], xdir: [1, 0, 0] },
  points: [{ id: 1, u: 0, v: 0 }, { id: 2, u: 5, v: 0 }],
  entities: [{ id: 10, type: "line", a: 1, b: 2 }, { id: 11, type: "line", a: 1, b: 2 }, { id: 12, type: "circle", center: 1, radius: 2 }],
  constraints: [],
};

test("the sketch selection is named by kind and count", () => {
  assert.equal(sketchSelectionText(s, []), "");
  assert.equal(sketchSelectionText(s, [{ kind: "entity", id: 12 }]), "1 circle");
  assert.equal(sketchSelectionText(s, [{ kind: "entity", id: 10 }, { kind: "entity", id: 11 }, { kind: "point", id: 1 }]), "2 lines, 1 point");
  assert.equal(sketchSelectionText(s, [{ kind: "entity", id: -1 }]), "1 axis");
});

import { describeSelection } from "../src/selectedreadout.ts";

const look = {
  bodyName: (id) => ({ 1: "bracket", 2: "block" })[id],
  owner: (kind, id) => (kind === "face" ? (id < 20 ? 1 : id < 40 ? 2 : null) : 1),
};

test("nothing selected gives an empty readout", () => {
  assert.deepEqual(describeSelection([], look), { text: "", full: "" });
});

test("bodies are listed by name, and counted past three", () => {
  assert.equal(describeSelection([{ kind: "body", id: 1 }, { kind: "body", id: 2 }], look).text, "bracket, block");
  const many = [1, 2, 3, 4, 5].map((id) => ({ kind: "body", id }));
  const r = describeSelection(many, look);
  assert.equal(r.text, "bracket, block, body 3 +2 more");
  assert.equal(r.full, "bracket, block, body 3, body 4, body 5");
});

test("faces are named with their body and number", () => {
  assert.equal(describeSelection([{ kind: "face", id: 12 }], look).text, "bracket: face 12");
  assert.equal(describeSelection([{ kind: "face", id: 12 }, { kind: "face", id: 14 }, { kind: "face", id: 19 }], look).text, "bracket: face 12, face 14, face 19");
});

test("faces of two bodies are grouped, and a long group is counted with the whole list in the tooltip", () => {
  const sels = [12, 14, 19, 5, 25].map((id) => ({ kind: "face", id }));
  const r = describeSelection(sels, look);
  assert.equal(r.text, "bracket: 4 faces; block: face 25");
  assert.equal(r.full, "bracket: face 12, face 14, face 19, face 5; block: face 25");
});

test("a face with no owning body has no prefix, and a global axis is appended", () => {
  assert.equal(describeSelection([{ kind: "face", id: 50 }, { kind: "axis", id: 0 }], look).text, "face 50; X axis");
});

test("mixed kinds of one body are listed together", () => {
  assert.equal(describeSelection([{ kind: "face", id: 3 }, { kind: "edge", id: 7 }], look).text, "bracket: face 3, edge 7");
});
