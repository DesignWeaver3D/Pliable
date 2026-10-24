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
