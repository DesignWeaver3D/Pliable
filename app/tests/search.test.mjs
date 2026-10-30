import test from "node:test";
import assert from "node:assert/strict";
import { parseQuery, searchItems, pushRecent, loadRecents, toolKeywords, matchRank } from "../src/search.ts";

const items = [
  { label: "Fillet/Chamfer", scope: "tool", keywords: toolKeywords("fillet_chamfer") },
  { label: "Move body", scope: "tool", keywords: toolKeywords("move_body") },
  { label: "Move hole / boss", scope: "tool", keywords: toolKeywords("move_hole") },
  { label: "Add hole", scope: "tool", keywords: toolKeywords("add_hole") },
  { label: "Setting: Sharp edge angle", scope: "setting" },
  { label: "Undo", scope: "view" },
];

test("scope prefixes", () => {
  assert.deepEqual(parseQuery("t:fil"), { scope: "tool", text: "fil" });
  assert.deepEqual(parseQuery("S: sharp"), { scope: "setting", text: "sharp" });
  assert.deepEqual(parseQuery("x:foo"), { scope: null, text: "x:foo" });
  assert.deepEqual(parseQuery("v:"), { scope: "view", text: "" });
});

test("keywords find tools by other names", () => {
  assert.equal(searchItems(items, "round")[0].label, "Fillet/Chamfer");
  const hole = searchItems(items, "hole").map((i) => i.label);
  assert.ok(hole.includes("Add hole") && hole.includes("Move hole / boss"));
  const move = searchItems(items, "move").map((i) => i.label);
  assert.deepEqual(move.slice(0, 2), ["Move body", "Move hole / boss"]);
});

test("label start beats keyword and loose letters", () => {
  assert.equal(matchRank(items[1], "mov"), 0);
  assert.equal(matchRank(items[0], "bevel"), 3);
  assert.equal(matchRank(items[0], "fc"), 4);
  assert.equal(matchRank(items[0], "zzz"), null);
});

test("scope limits results", () => {
  assert.deepEqual(searchItems(items, "s:").map((i) => i.scope), ["setting"]);
  assert.deepEqual(searchItems(items, "t:move").length, 2);
});

test("recents come first when empty", () => {
  const out = searchItems(items, "", ["Undo", "Add hole"]).map((i) => i.label);
  assert.deepEqual(out.slice(0, 2), ["Undo", "Add hole"]);
  assert.equal(searchItems(items, "").length, items.length);
});

test("recents list is newest first, unique and capped", () => {
  assert.deepEqual(pushRecent(["a", "b", "c"], "b"), ["b", "a", "c"]);
  assert.equal(pushRecent(["1", "2", "3", "4", "5", "6"], "7").length, 6);
  assert.deepEqual(loadRecents({ getItem: () => "garbage" }), []);
  assert.deepEqual(loadRecents({ getItem: () => '["a",3]' }), ["a"]);
});
test("long queries need a real match", () => { assert.equal(matchRank({ label: "Keyboard shortcuts" }, "round"), null); });

test("the prism tool is found by polygon names", () => {
  const items = [{ label: "Add prism", scope: "tool", keywords: toolKeywords("add_prism") }];
  for (const word of ["hexagon", "polygon", "prism"]) assert.equal(searchItems(items, word)[0]?.label, "Add prism", word);
});

test("Unify, Patch fill, Bridge and Path array are found by their tool names", () => {
  const list = [
    { label: "Refine bodies", scope: "tool", keywords: toolKeywords("unify") },
    { label: "Patch fill", scope: "tool", keywords: toolKeywords("patch_fill") },
    { label: "Bridge edges", scope: "tool", keywords: toolKeywords("bridge") },
    { label: "Array along path", scope: "tool", keywords: toolKeywords("path_array") },
  ];
  assert.equal(searchItems(list, "unify")[0].label, "Refine bodies");
  assert.equal(searchItems(list, "Patch_fill")[0].label, "Patch fill");
  assert.equal(searchItems(list, "bridge")[0].label, "Bridge edges");
  assert.equal(searchItems(list, "path array")[0].label, "Array along path");
});

test("a tool the selection does not fit is still found, after equal matches that fit", () => {
  const list = [
    { label: "Move hole", scope: "tool", nofit: true },
    { label: "Move body", scope: "tool", nofit: false },
    { label: "Move face", scope: "tool", nofit: true },
  ];
  assert.deepEqual(searchItems(list, "move").map((i) => i.label), ["Move body", "Move hole", "Move face"]);
  assert.equal(searchItems(list, "face").length, 1);
});

test("remove fillet, chamfer and round find Defeature", () => {
  const defeature = { label: "Defeature", scope: "tool", keywords: toolKeywords("delete_face") };
  for (const word of ["remove fillet", "remove chamfer", "remove round"]) assert.equal(searchItems([defeature], word)[0]?.label, "Defeature", word);
});
