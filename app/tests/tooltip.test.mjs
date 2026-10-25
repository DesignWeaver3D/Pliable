// Run with: node --test app/tests   (tooltip text assembly for tool buttons, strip and search rows)
import test from "node:test";
import assert from "node:assert/strict";
import { toolTooltip } from "../src/tools.ts";

const tool = (extra = {}) => ({ id: "push_pull", label: "Push/Pull", description: "Moves flat faces in or out.", accepts: { faces: [1, null], edges: [0, 0] }, params: [], ...extra });

test("tooltip has the label, the description and the selection needs on a second line", () => {
  assert.equal(toolTooltip(tool()), "Push/Pull: Moves flat faces in or out.\nNeeds: 1+ faces");
});

test("a shortcut is shown after the description", () => {
  assert.equal(toolTooltip(tool(), "Ctrl+P").split("\n")[0], "Push/Pull: Moves flat faces in or out. (Ctrl+P)");
});

test("a tool that needs no selection says so", () => {
  assert.equal(toolTooltip(tool({ accepts: { faces: [0, 0], edges: [0, 0] } })).split("\n")[1], "No selection needed");
});

test("a missing description still gives a readable tooltip", () => {
  assert.match(toolTooltip(tool({ description: undefined })), /^Push\/Pull: Push\/Pull \(no description available\)/);
});
