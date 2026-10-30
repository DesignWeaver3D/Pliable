import test from "node:test";
import assert from "node:assert/strict";
import { acceptsSelection } from "../src/tools.ts";
import { createWaitingTool, waitingHint } from "../src/toolwaiting.ts";

const extrude = { id: "push_pull", label: "Push/Pull", accepts: { faces: [1, 1], edges: [0, 0] } };
const fillet = { id: "fillet_chamfer", label: "Fillet", accepts: { faces: [0, 0], edges: [1, null] } };
const face = { kind: "face", id: 1 };
const edge = { kind: "edge", id: 2 };

test("the hint names the tool and what to select", () => {
  assert.equal(waitingHint(extrude), "Push/Pull: select 1 face to use it");
  assert.equal(waitingHint(fillet), "Fillet: select 1+ edges to use it");
});

test("a tool chosen with the wrong selection waits, and starts once the selection fits", () => {
  const w = createWaitingTool();
  w.wait(extrude);
  assert.equal(w.take((t) => acceptsSelection(t, [edge])), null);
  assert.equal(w.tool, extrude); // still waiting
  assert.equal(w.take((t) => acceptsSelection(t, [face])), extrude);
  assert.equal(w.tool, null); // it started once
  assert.equal(w.take(() => true), null);
});

test("choosing another tool replaces the wait, and cancel ends it", () => {
  const w = createWaitingTool();
  w.wait(extrude);
  w.wait(fillet);
  assert.equal(w.take((t) => acceptsSelection(t, [face])), null);
  assert.equal(w.take((t) => acceptsSelection(t, [edge])), fillet);
  w.wait(extrude);
  w.cancel();
  assert.equal(w.take(() => true), null);
});
