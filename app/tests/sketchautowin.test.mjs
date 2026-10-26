import test from "node:test";
import assert from "node:assert/strict";
import { automaticInTheWay } from "../src/sketchautowin.ts";

test("only blamed automatic constraints are candidates, never the one just added", () => {
  const cs = [{ id: 1, type: "horizontal", auto: true }, { id: 2, type: "vertical", auto: true }, { id: 3, type: "equal" }, { id: 4, type: "horizontal" }];
  assert.deepEqual(automaticInTheWay(cs, new Set([1, 3, 4]), new Set([4])).map((c) => c.id), [1]);
  assert.deepEqual(automaticInTheWay(cs, new Set([3, 4]), new Set([4])), []);
});
