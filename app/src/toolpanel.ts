/** "All tools" list (grouped by layout.ts) and the parameter form for tools that are not dragged. */
import { TOOL_GROUPS } from "./layout";
import { describeNeeds, type ToolInfo } from "./tools";

export interface ToolPanelHost {
  tools(): ToolInfo[];
  usable(tool: ToolInfo): boolean;
  /** Run the tool with these values without committing (live preview). */
  preview(tool: ToolInfo, values: Record<string, number>): Promise<void>;
  commit(tool: ToolInfo, values: Record<string, number>): Promise<void>;
  cancel(): void;
}

const PREVIEW_DELAY_MS = 150;
const UNITS: Record<string, string> = { length: "mm", angle: "°", number: "" };

export class ToolPanel {
  private open: ToolInfo | null = null;
  private timer = 0;
  private inputs: Record<string, HTMLInputElement> = {};

  constructor(
    private readonly listEl: HTMLElement,
    private readonly formEl: HTMLElement,
    private readonly host: ToolPanelHost,
  ) {}

  private listKey = "";
  private listButtons = new Map<string, HTMLButtonElement>();

  /** Refresh the grouped list; call when tools or the selection change. Only rebuilds when the tool set changed, so scroll position and hover survive a selection. */
  renderList() {
    const tools = this.host.tools();
    const placed = new Set(TOOL_GROUPS.flatMap((g) => g.tools));
    const groups = [
      ...TOOL_GROUPS.map((g) => ({ title: g.title, tools: g.tools.map((id) => tools.find((t) => t.id === id)).filter((t): t is ToolInfo => !!t) })),
      { title: "Other", tools: tools.filter((t) => !placed.has(t.id)) },
    ].filter((g) => g.tools.length);
    const key = groups.map((g) => `${g.title}:${g.tools.map((t) => t.id).join(",")}`).join("|");
    if (key === this.listKey) {
      for (const [id, button] of this.listButtons) button.disabled = !this.host.usable(tools.find((t) => t.id === id)!);
      return;
    }
    this.listKey = key;
    this.listButtons.clear();
    this.listEl.replaceChildren(
      ...groups.map((group) => {
        const box = document.createElement("div");
        const title = document.createElement("div");
        title.className = "group";
        title.textContent = group.title;
        box.append(title);
        for (const tool of group.tools) {
          const button = document.createElement("button");
          button.textContent = tool.label;
          button.disabled = !this.host.usable(tool);
          button.title = describeNeeds(tool) || "No selection needed";
          button.addEventListener("click", () => this.openForm(tool));
          this.listButtons.set(tool.id, button);
          box.append(button);
        }
        return box;
      }),
    );
  }

  get isOpen(): boolean {
    return this.open !== null;
  }

  /** Close the form without committing (the host restores the committed model). */
  close(restore = true) {
    if (!this.open) return;
    this.open = null;
    clearTimeout(this.timer);
    this.formEl.hidden = true;
    this.formEl.replaceChildren();
    if (restore) this.host.cancel();
  }

  /** Open the form for a tool; `initial` pre-fills values (used to re-edit the last operation). */
  openForm(tool: ToolInfo, initial: Record<string, number> = {}) {
    this.close();
    this.open = tool;
    const inputs: Record<string, HTMLInputElement> = {};
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = tool.label;
    const rows = tool.params.map((p) => {
      const row = document.createElement("label");
      row.className = "row";
      const name = document.createElement("span");
      name.textContent = `${p.name.replace(/_/g, " ")}${UNITS[p.kind] ? ` (${UNITS[p.kind]})` : ""}`;
      const input = document.createElement("input");
      input.type = "number";
      input.step = "any";
      input.value = String(initial[p.name] ?? p.default);
      input.addEventListener("input", () => this.schedulePreview());
      input.addEventListener("keydown", (e) => {
        e.stopPropagation(); // typing must not trigger view shortcuts or tools
        if (e.key === "Enter") this.apply();
        else if (e.key === "Escape") this.close();
      });
      inputs[p.name] = input;
      row.append(name, input);
      return row;
    });
    const apply = document.createElement("button");
    apply.textContent = "Apply";
    apply.addEventListener("click", () => this.apply());
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => this.close());
    const buttons = document.createElement("div");
    buttons.className = "buttons";
    buttons.append(apply, cancel);
    this.formEl.replaceChildren(title, ...rows, buttons);
    this.formEl.hidden = false;
    this.inputs = inputs;
    (Object.values(inputs)[0] ?? apply).focus();
    this.schedulePreview(0);
  }

  private values(): Record<string, number> {
    return Object.fromEntries(Object.entries(this.inputs).map(([k, el]) => [k, Number(el.value)]));
  }

  private schedulePreview(delay = PREVIEW_DELAY_MS) {
    clearTimeout(this.timer);
    const tool = this.open;
    if (!tool) return;
    this.timer = window.setTimeout(() => this.host.preview(tool, this.values()), delay);
  }

  private async apply() {
    const tool = this.open;
    if (!tool) return;
    const values = this.values();
    this.close(false);
    await this.host.commit(tool, values);
  }
}
