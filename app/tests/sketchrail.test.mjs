// Run with: node --test app/tests
import test from "node:test";
import assert from "node:assert/strict";
import { acceptsWithRail } from "../src/sketchrail.ts";

const sweep = { id: "sweep_face", accepts: { faces: [1, 1], edges: [1, 1] }, railAccepts: { faces: [1, 1], edges: [0, 0] } };
const plain = { id: "push_pull", accepts: { faces: [1, null], edges: [0, 0] } };

test("a chosen sketch stands in for the edge a path tool needs", () => {
  assert.equal(acceptsWithRail(sweep, [{ kind: "face", id: 1 }], 3), true);
  assert.equal(acceptsWithRail(sweep, [{ kind: "face", id: 1 }], null), false);
  assert.equal(acceptsWithRail(sweep, [], 3), false); // the face to sweep is still needed
});

test("selected edges are used instead of the sketch, and other tools ignore it", () => {
  assert.equal(acceptsWithRail(sweep, [{ kind: "face", id: 1 }, { kind: "edge", id: 2 }], 3), false);
  assert.equal(acceptsWithRail(plain, [{ kind: "face", id: 1 }], 3), false);
});
