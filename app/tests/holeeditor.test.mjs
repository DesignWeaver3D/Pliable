import test from "node:test";
import assert from "node:assert/strict";
import { sectionsFor } from "../src/holeeditor.ts";
import { diameterPresets } from "../src/holepresets.ts";
import { featurePresets, featuresOf, hiddenFields, resolveEnds } from "../src/holefeatures.ts";
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

test("one hole and a new hole are one form, several holes keep their sections", () => {
  assert.deepEqual(sectionsFor("new").map((s) => s.tool), ["hole_features"]);
  assert.equal(sectionsFor("hole")[0].tool, "hole_features");
  assert.equal(sectionsFor("holes", 3)[0].tool, "resize_hole");
});

test("Fill follows the pick; the several-hole sections are as they were", () => {
  const ids = (pick) => sectionsFor("hole", 1, pick).map((s) => s.tool);
  assert.deepEqual(ids("other"), ["hole_features"]);
  assert.deepEqual(ids("cylinder"), ["hole_features", "fill_hole"]);
  assert.deepEqual(ids("wall"), ["hole_features", "fill_hole"]);
  assert.deepEqual(sectionsFor("holes", 2).map((s) => s.tool), ["resize_hole", "move_hole", "align_holes", "fill_hole"]);
  assert.deepEqual(sectionsFor("holes", 4).map((s) => s.tool), ["resize_hole", "move_hole", "align_holes", "distribute_holes", "fill_hole"]);
});

test("one preset sets the size, the thread and the counterbore and countersink together, and switches nothing on", () => {
  const names = ["M3", "M4", "M5", "M6"];
  const presets = featurePresets(names);
  const m5 = presets.find((p) => p.label.startsWith("M5 clearance, medium"));
  assert.equal(m5.values.diameter, 5.5);
  assert.equal(m5.values.thread_size, 3);
  assert.equal(m5.values.bore_diameter, 10);
  assert.equal(m5.values.sink_diameter, 11.2);
  for (const name of ["counterbore", "countersink", "thread"]) assert.ok(!(name in m5.values));
  const inch = presets.find((p) => p.label.startsWith("1/4-20 tap drill"));
  assert.equal(inch.values.thread_size, 0); // not in the standard list: Custom with its pitch
  assert.equal(inch.values.thread_pitch, 1.27);
  assert.equal(inch.values.sink_angle, 82);
});

test("the switches show their own fields and nothing else", () => {
  const off = { counterbore: 0, countersink: 0, thread: 0, depth: 0 };
  assert.ok(hiddenFields("new", off).includes("bore_diameter") && hiddenFields("new", off).includes("thread_size"));
  assert.ok(hiddenFields("new", off).includes("dx") && !hiddenFields("hole", off).includes("dx"));
  assert.ok(hiddenFields("hole", off).includes("offset_u"));
  const on = { counterbore: 1, countersink: 1, thread: 1, depth: 0, thread_size: 0, bore_end: 0, sink_end: 1 };
  const hidden = hiddenFields("new", on);
  assert.ok(!hidden.includes("bore_diameter") && !hidden.includes("sink_angle") && !hidden.includes("thread_pitch") && !hidden.includes("sink_end"));
  assert.ok(hiddenFields("new", { ...on, thread_size: 3 }).includes("thread_pitch")); // a standard size has its own pitch
  assert.ok(hiddenFields("new", { ...on, depth: 8 }).includes("bore_end")); // a blind hole has no far end
});

test("a counterbore and a countersink at one end: the one switched on later replaces the other", () => {
  const both = { counterbore: 1, countersink: 1, bore_end: 0, sink_end: 0, depth: 0 };
  assert.deepEqual(resolveEnds("countersink", both, "new"), { counterbore: 0 });
  assert.deepEqual(resolveEnds("counterbore", both, "hole"), { countersink: 0 });
  assert.deepEqual(resolveEnds("sink_end", both, "new"), { counterbore: 0 });
  assert.deepEqual(resolveEnds("countersink", { ...both, sink_end: 1 }, "new"), {}); // opening and far end: both stay
  assert.deepEqual(resolveEnds("depth", { ...both, sink_end: 1, depth: 8 }, "new"), { sink_end: 0, counterbore: 0 }); // blind: back to the opening
});

test("the picture follows the switches", () => {
  assert.deepEqual(featuresOf({ counterbore: 1, bore_end: 0, countersink: 1, sink_end: 1, thread: 1 }), { bore: 0, sink: 1, thread: true });
  assert.deepEqual(featuresOf({}), { bore: null, sink: null, thread: false });
});

test("preset lists fill the fields their forms have", () => {
  const sizes = diameterPresets();
  assert.ok(sizes.some((p) => p.label.startsWith("M6 clearance, medium") && p.values.diameter === 6.6));
  assert.ok(sizes.some((p) => p.system === "inch" && p.label.startsWith("1/4-20 tap drill")));
});

test("the Hole Editor entry is found by hole, drill and bore", async () => {
  const { searchItems, toolKeywords } = await import("../src/search.ts");
  const items = [{ label: "Hole Editor", scope: "tool", keywords: toolKeywords("hole_editor") }];
  for (const word of ["hole", "drill", "bore"]) assert.deepEqual(searchItems(items, word).map((i) => i.label), ["Hole Editor"]);
});

test("the thread sizes come from the one form's own list", async () => {
  const { threadSizeNames } = await import("../src/holethreadsizes.ts");
  const tool = { id: "hole_features", params: [{ name: "thread_size", options: ["Custom", "M3", "M4"] }] };
  assert.deepEqual(threadSizeNames([tool]), ["M3", "M4"]);
});

test("the one form's countersink angle gets the list of standard head angles", async () => {
  const { hasAngles } = await import("../src/holesizes.ts");
  assert.ok(hasAngles("hole_features", "sink_angle"));
  assert.ok(!hasAngles("hole_features", "bore_depth"));
});
