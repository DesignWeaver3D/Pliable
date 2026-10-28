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
