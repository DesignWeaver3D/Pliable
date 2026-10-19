import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_GROUPS } from "../src/layout.ts";
import { allToolIconIds, initialsIcon, toolIconInner } from "../src/icons.ts";

test("every tool in the layout groups has a drawn icon", () => {
  const drawn = new Set(allToolIconIds());
  const missing = TOOL_GROUPS.flatMap((g) => g.tools).filter((id) => !drawn.has(id));
  assert.deepEqual(missing, []);
});

test("a tool without an icon falls back to its initials", () => {
  assert.equal(toolIconInner("no_such_tool", "Fill hole"), initialsIcon("Fill hole"));
  assert.match(initialsIcon("Fill hole"), />FH</);
});

test("the Tools button uses the left-sidebar icon: a frame, a divider and a filled left pane", async () => {
  const { UI_ICONS, allUiIconNames } = await import("../src/icons.ts");
  assert.ok(allUiIconNames().includes("sidebar"));
  assert.ok(!allUiIconNames().includes("tools"));
  const inner = UI_ICONS.sidebar;
  assert.match(inner, /<rect/);
  assert.match(inner, /<path d="M10 4\.5v15"\/>/);
  assert.match(inner, /fill="currentColor"/);
});
