/** Combined tools: one drawer entry whose modes are separate core tools with their own parameters. The side panel shows a row of mode buttons above the form;
 *  choosing a mode swaps the form for that tool's. Add a group here to combine more tools the same way (the members need no code of their own). */
import type { ToolInfo } from "./tools.ts";

export interface ModeGroup {
  id: string;
  label: string;
  description: string;
  modes: { tool: string; label: string }[];
}

export const MODE_GROUPS: ModeGroup[] = [
  {
    id: "fillet_modes",
    label: "Fillet/Chamfer",
    description: "Rounds or bevels the selected edges. Constant: one radius or distance; Variable: a radius that changes along each edge; Per edge: each edge its own radius; Two distances and Distance and angle: a bevel measured on the face beside the edge; Face edges: every edge around the selected faces. Select edges (or faces for Face edges) first, then choose the mode.",
    modes: [
      { tool: "fillet_chamfer", label: "Constant" },
      { tool: "variable_fillet", label: "Variable" },
      { tool: "fillet_per_edge", label: "Per edge" },
      { tool: "chamfer_two_distances", label: "Two distances" },
      { tool: "chamfer_distance_angle", label: "Distance and angle" },
      { tool: "round_face", label: "Face edges" },
    ],
  },
];

/** The member tools: they stay registered in the core but have no button of their own. */
export const MODE_MEMBERS: ReadonlySet<string> = new Set(MODE_GROUPS.flatMap((g) => g.modes.map((m) => m.tool)));

export function modeGroupOf(toolId: string): ModeGroup | null {
  return MODE_GROUPS.find((g) => g.id === toolId || g.modes.some((m) => m.tool === toolId)) ?? null;
}

/** The drawer entries of the groups whose first member the core listed (the entry takes that member's selection rules). */
export function modeGroupTools(tools: ToolInfo[]): ToolInfo[] {
  const out: ToolInfo[] = [];
  for (const group of MODE_GROUPS) {
    const first = tools.find((t) => t.id === group.modes[0].tool);
    if (first) out.push({ id: group.id, label: group.label, description: group.description, accepts: { faces: [0, null], edges: [0, null], anyOf: true }, params: [], startsFrom: "selection", hasHandles: false });
  }
  return out;
}

/** The mode buttons above an open mode form; `choose` opens the other mode's tool. Null when the tool is not a mode. */
export function modeHeader(tool: ToolInfo, tools: ToolInfo[], choose: (member: ToolInfo) => void): HTMLElement | null {
  const group = modeGroupOf(tool.id);
  if (!group) return null;
  const box = document.createElement("div");
  const title = document.createElement("div");
  title.className = "title";
  title.textContent = group.label;
  const tabs = document.createElement("div");
  tabs.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px";
  for (const mode of group.modes) {
    const member = tools.find((t) => t.id === mode.tool);
    if (!member) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = mode.label;
    button.title = member.description ?? mode.label;
    button.style.cssText = "text-align:center;margin-top:2px;width:auto;flex:1 1 auto";
    button.classList.toggle("active", member.id === tool.id);
    button.addEventListener("click", () => member.id !== tool.id && choose(member));
    tabs.append(button);
  }
  box.append(title, tabs);
  return box;
}
