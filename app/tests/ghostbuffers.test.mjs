import test from "node:test";
import assert from "node:assert/strict";
import { ghostOf } from "../src/ghostbuffers.ts";

const buffers = { ghostPositions: new Float32Array(9), ghostNormals: new Float32Array(9), ghostIndices: new Uint32Array([0, 1, 2]) };

test("a reply with ghost buffers gives them", () => {
  const g = ghostOf({ ghost: { triangles: 1, bounds: [0, 0, 0, 1, 1, 1] } }, buffers);
  assert.equal(g.indices.length, 3);
});

test("a reply without the field, with no triangles or without the buffers has no ghost", () => {
  assert.equal(ghostOf({}, buffers), null);
  assert.equal(ghostOf({ ghost: { triangles: 0 } }, buffers), null);
  assert.equal(ghostOf({ ghost: { triangles: 1 } }, {}), null);
});
