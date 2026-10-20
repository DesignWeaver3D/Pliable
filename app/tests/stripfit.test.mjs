import test from "node:test";
import assert from "node:assert/strict";
import { stripRoom } from "../src/stripfit.ts";

test("the strip is centred in the room between the left and right sides", () => {
  assert.deepEqual(stripRoom(1400, 240, 200), { width: 960, centre: 720 });
  assert.deepEqual(stripRoom(1400, 540, 160), { width: 700, centre: 890 });
  assert.equal(stripRoom(300, 240, 240).width, 120);
});
