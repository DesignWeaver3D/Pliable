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

const candidates = ["toolsBox"];
const sizes = [16, 20, 24, 32];
const rows = candidates.map((id) => `<div class="cand"><code>${id}</code>${sizes.map((n) => `<span class="icon" title="${n}px">${svgFor(UI_ICONS[id], n)}</span>`).join("")}</div>`).join("");
const handles = candidates.map((id) => `<div class="mock"><div class="tab"><span class="icon">${svgFor(UI_ICONS[id], 24)}</span><span class="icon">${svgFor('<path d="M9 6l6 6-6 6"/>', 10)}</span></div><code>${id}</code></div>`).join("");
sheet.insertAdjacentHTML("afterbegin", `<h2>Tools handle candidates (16, 20, 24, 32 px) and planned left-edge handle mock (32 x 48 px)</h2><div id="cands">${rows}</div><div class="mocks">${handles}</div>`);
