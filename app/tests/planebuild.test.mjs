// Run with: node --test app/tests
import test from "node:test";
import assert from "node:assert/strict";
import { edgePointRequest, faceShiftRequest, threePointRequest } from "../src/planebuild.ts";

test("the plane requests carry the picked ids", () => {
  assert.deepEqual(threePointRequest([1, 2, 3]), { vertices: [1, 2, 3] });
  assert.deepEqual(edgePointRequest(4, 5), { edge: 4, vertex: 5 });
});

test("a face offset and angle read blank or invalid text as 0", () => {
  assert.deepEqual(faceShiftRequest(7, "12.5", "30"), { face: 7, offset: 12.5, angle: 30 });
  assert.deepEqual(faceShiftRequest(7, "", "abc"), { face: 7, offset: 0, angle: 0 });
});
