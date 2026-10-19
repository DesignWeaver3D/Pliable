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

test("the view controls have drawn icons, and axes is drawn with three axis lines", async () => {
  const { UI_ICONS, allUiIconNames } = await import("../src/icons.ts");
  for (const name of ["axes", "iso", "perspective", "orthographic"]) assert.ok(allUiIconNames().includes(name), name);
  assert.equal((UI_ICONS.axes.match(/<path/g) ?? []).length, 3);
});

test("the tools handle candidates are drawn as valid, currentColor-based SVG", async () => {
  const { UI_ICONS, svgFor } = await import("../src/icons.ts");
  for (const id of ["toolsBox"]) {
    assert.ok(UI_ICONS[id] && UI_ICONS[id].length > 0, id);
    const svg = svgFor(UI_ICONS[id], 24);
    assert.match(svg, /^<svg [^>]*viewBox="0 0 24 24"[^>]*stroke="currentColor"[\s\S]*<\/svg>$/);
    assert.ok((svg.match(/<(path|g|rect)\b/g) ?? []).length > 0);
    assert.equal((svg.match(/<g\b/g) ?? []).length, (svg.match(/<\/g>/g) ?? []).length);
  }
});
