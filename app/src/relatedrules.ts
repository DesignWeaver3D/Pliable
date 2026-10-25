/** Relationship rules: faces related to the selected face by a rule that is on are highlighted and join the selection
 *  of the tools that declare the rule; the chips under the view switch the rules. Moved out of main.ts. */
import type { Sel, Viewport } from "./viewport";
import type { ToolInfo } from "./tools";

export interface RelatedRule {
  id: string;
  label: string;
  faces: number[];
}

/** The rules that apply to the face now selected (set by main.ts when the core answers). */
export const relatedState: { rules: RelatedRule[] } = { rules: [] };

// What a tool applies to is decided per tool: a saved choice for the tool, else a saved choice for all tools,
// else the tool's own default, else the base default. Until a rule is defined for a tool, its chip is shown but off.
const BASE_RULES: Record<string, boolean> = { coplanar: false, parallel: false, equal_radius: false, coaxial: false, symmetric: false };
const TOOL_RULES: Record<string, Record<string, boolean>> = { resize_hole: { equal_radius: true } };
const RULES_KEY = "pliable.rules";
let ruleChoices: Record<string, boolean> = {};
try {
  ruleChoices = JSON.parse(localStorage.getItem(RULES_KEY) ?? "{}");
} catch {
  /* storage can be blocked */
}
export function ruleFor(toolId: string | null, rule: string): boolean {
  return ruleChoices[`${toolId}:${rule}`] ?? ruleChoices[`*:${rule}`] ?? (toolId ? TOOL_RULES[toolId]?.[rule] : undefined) ?? BASE_RULES[rule] ?? false;
}
export function setRule(toolId: string | null, rule: string, on: boolean) {
  ruleChoices[`${toolId ?? "*"}:${rule}`] = on;
  try {
    localStorage.setItem(RULES_KEY, JSON.stringify(ruleChoices));
  } catch {
    /* ignore */
  }
}


/** The selection a tool runs on: the picked items plus the faces of its related rules that are switched on. */
export function expand(tool: ToolInfo | null, sels: Sel[]): Sel[] {
  if (!tool?.related?.length || sels.length !== 1 || sels[0].kind !== "face") return sels;
  const extra = new Set<number>();
  for (const rule of relatedState.rules) if (tool.related.includes(rule.id) && ruleFor(tool.id, rule.id)) rule.faces.forEach((f) => extra.add(f));
  return [...sels, ...[...extra].filter((f) => f !== sels[0].id).map((id) => ({ kind: "face" as const, id }))];
}

export interface ChipDeps {
  chips: HTMLElement;
  viewport: Viewport;
  /** The tool the chips speak for: the armed tool, else the open form's tool, else none (a choice for all tools). */
  tool(): string | null;
  /** Redraw what depends on the rules (the tool strip and the tool list). */
  changed(): void;
}

export function renderChips(d: ChipDeps) {
  const shown = relatedState.rules.filter((r) => r.faces.length);
  const ctx = d.tool();
  const ruleOn = (id: string) => ruleFor(ctx, id);
  const all = (label: string, on: boolean) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.className = "all";
    b.title = on ? "Include every related face shown here in the selection" : "Include none of the related faces; tools change only the selected face";
    b.addEventListener("click", () => {
      for (const rule of shown) setRule(ctx, rule.id, on);
      renderChips(d);
      d.changed();
    });
    return b;
  };
  d.chips.replaceChildren(
    ...(shown.length > 1 ? [all("All", true), all("None", false)] : []),
    ...shown.map((rule) => {
      const b = document.createElement("button");
      const n = rule.faces.length;
      const what = `${rule.label.toLowerCase()} face${n === 1 ? "" : "s"}`;
      b.textContent = `${ruleOn(rule.id) ? "✔ With" : "+ Add"} ${n} ${what}`;
      b.className = ruleOn(rule.id) ? "on" : "";
      b.title = ruleOn(rule.id) ? `The ${n} ${what} are included with the selected face; click to exclude them` : `The ${n} ${what} are not included yet; click to include them with the selected face`;
      b.addEventListener("click", () => {
        setRule(ctx, rule.id, !ruleOn(rule.id));
        renderChips(d);
        d.changed();
      });
      return b;
    }),
  );
  const faces = new Set<number>();
  for (const rule of shown) if (ruleOn(rule.id)) rule.faces.forEach((f) => faces.add(f));
  d.viewport.setRelated([...faces].map((id) => ({ kind: "face" as const, id })));
}
