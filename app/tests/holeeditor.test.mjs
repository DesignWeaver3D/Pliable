import test from "node:test";
import assert from "node:assert/strict";
import { sectionsFor } from "../src/holeeditor.ts";
import { diameterPresets, counterborePresets, countersinkPresets } from "../src/holepresets.ts";
import { holeEditorTool } from "../src/holeeditortool.ts";
import { acceptsSelection } from "../src/tools.ts";

test("the Hole Editor entry fits one face, many faces or one edge, and nothing else", () => {
  const tool = holeEditorTool();
  const face = (id) => ({ kind: "face", id });
  assert.ok(acceptsSelection(tool, [face(1)]));
  assert.ok(acceptsSelection(tool, [face(1), face(2), face(3)]));
  assert.ok(acceptsSelection(tool, [{ kind: "edge", id: 4 }]));
  assert.ok(!acceptsSelection(tool, []));
  assert.ok(!acceptsSelection(tool, [{ kind: "edge", id: 4 }, { kind: "edge", id: 5 }]));
  assert.ok(!acceptsSelection(tool, [{ kind: "body", id: 1 }]));
});

test("one hole is edited with the Edit hole form, several with the Resize form", () => {
  assert.equal(sectionsFor("hole")[0].tool, "edit_hole");
  assert.equal(sectionsFor("holes", 3)[0].tool, "resize_hole");
});

test("a counterbore, countersink, thread and fill section follow the pick", () => {
  const ids = (pick) => sectionsFor("hole", 1, pick).map((s) => s.tool);
  assert.deepEqual(ids("other"), ["edit_hole", "convert_to_counterbore", "convert_to_countersink"]);
  assert.deepEqual(ids("cylinder"), ["edit_hole", "convert_to_counterbore", "convert_to_countersink", "fill_hole"]);
  assert.deepEqual(ids("wall"), ["edit_hole", "convert_to_counterbore", "convert_to_countersink", "thread_hole", "fill_hole"]);
  assert.deepEqual(sectionsFor("holes", 2).map((s) => s.tool), ["resize_hole", "move_hole", "align_holes", "fill_hole"]);
  assert.deepEqual(sectionsFor("holes", 4).map((s) => s.tool), ["resize_hole", "move_hole", "align_holes", "distribute_holes", "fill_hole"]);
});

test("preset lists fill the fields their forms have", () => {
  const sizes = diameterPresets();
  assert.ok(sizes.some((p) => p.label.startsWith("M6 clearance, medium") && p.values.diameter === 6.6));
  assert.ok(sizes.some((p) => p.system === "inch" && p.label.startsWith("1/4-20 tap drill")));
  assert.deepEqual(Object.keys(counterborePresets()[0].values), ["bore_by", "bore_diameter", "bore_depth"]);
  assert.deepEqual(Object.keys(countersinkPresets()[0].values), ["sink_by", "sink_diameter", "sink_angle"]);
});

test("the Hole Editor entry is found by hole, drill and bore", async () => {
  const { searchItems, toolKeywords } = await import("../src/search.ts");
  const items = [{ label: "Hole Editor", scope: "tool", keywords: toolKeywords("hole_editor") }];
  for (const word of ["hole", "drill", "bore"]) assert.deepEqual(searchItems(items, word).map((i) => i.label), ["Hole Editor"]);
});

test("a flat face offers the three ways of making a new hole", () => {
  assert.deepEqual(sectionsFor("new").map((s) => s.tool), ["add_hole", "add_counterbore", "add_countersink"]);
  assert.ok(counterborePresets(true)[0].values.diameter > 0 && !("diameter" in counterborePresets()[0].values));
});

test("a hole whose bore can be threaded offers Thread whichever face of it was picked", () => {
  const ids = (pick, threadable) => sectionsFor("hole", 1, pick, threadable).map((s) => s.tool);
  assert.ok(ids("other", true).includes("thread_hole"));
  assert.ok(!ids("wall", false).includes("thread_hole"));
  assert.ok(ids("wall").includes("thread_hole")); // when the core does not say, a picked whole wall can be threaded
});

test("a thread chosen with a new hole is cut on the bore the commit kept selected, in the hole's undo step", async () => {
  const { threadRequest, threadSizeNames, NO_THREAD } = await import("../src/holethread.ts");
  const payload = (sels) => ({ faces: sels.map((s) => s.id) });
  const kept = [{ kind: "face", id: 7 }];
  const m6 = { size: 4, left: false };
  const request = threadRequest("add_counterbore", m6, kept, payload);
  assert.deepEqual(request.selection, { faces: [7] });
  assert.equal(request.tool, "thread_hole");
  assert.equal(request.params.size, 4);
  assert.equal(request.foldPick, true);
  assert.equal(threadRequest("add_hole", { size: 4, left: true }, kept, payload).params.hand, 1);
  assert.equal(threadRequest("add_hole", NO_THREAD, kept, payload), null); // no thread chosen
  assert.equal(threadRequest("edit_hole", m6, kept, payload), null); // only the new-hole tools
  assert.equal(threadRequest("add_hole", m6, [], payload), null); // nothing kept to thread
  const tool = { id: "thread_hole", params: [{ name: "size", options: ["Custom", "M3", "M4"] }] };
  assert.deepEqual(threadSizeNames([tool]), ["M3", "M4"]);
});
