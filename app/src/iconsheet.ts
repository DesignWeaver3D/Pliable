// Contact sheet for reviewing every icon (dev server: /icons.html).
import { TOOL_GROUPS } from "./layout";
import { UI_ICONS, allToolIconIds, svgFor, toolIconInner } from "./icons";

const sheet = document.getElementById("sheet")!;
const cell = (id: string, inner: string) =>
  `<div class="cell"><div class="row"><span class="icon">${svgFor(inner, 48)}</span><span class="icon">${svgFor(inner, 24)}</span><span class="icon">${svgFor(inner, 16)}</span></div><code>${id}</code></div>`;
const placed = new Set(TOOL_GROUPS.flatMap((g) => g.tools));
const known = allToolIconIds();
const groups = [
  ...TOOL_GROUPS.map((g) => ({ title: g.title, ids: g.tools })),
  { title: "Not in a group (initials fallback unless drawn)", ids: [...known.filter((id) => !placed.has(id)), "defeature", "unknown_tool"] },
];
sheet.innerHTML =
  groups.map((g) => `<h2>${g.title}</h2><div class="grid">${g.ids.map((id) => cell(id, toolIconInner(id))).join("")}</div>`).join("") +
  `<h2>Interface</h2><div class="grid">${Object.entries(UI_ICONS).map(([name, inner]) => cell(name, inner)).join("")}</div>`;
