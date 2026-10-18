/** "All tools" list (grouped by layout.ts) and the parameter form for tools that are not dragged. */
import { TOOL_GROUPS } from "./layout";
import { describeNeeds, type ToolInfo } from "./tools";
import { usage, type Surface } from "./usage";

/** A parameter value: a number, or for `per_edge` parameters one [start, end] radius pair per selected edge. */
export type ParamValue = number | number[][];

export interface ToolPanelHost {
  /** Ids of the selected edges, in selection order (rows of a `per_edge` parameter). */
  selectedEdges?(): number[];
  tools(): ToolInfo[];
  usable(tool: ToolInfo): boolean;
  /** Run the tool with these values without committing (live preview). */
  preview(tool: ToolInfo, values: Record<string, ParamValue>): Promise<void>;
  commit(tool: ToolInfo, values: Record<string, ParamValue>): Promise<void>;
  cancel(): void;
  /** Eyedropper: wait for the next click on the model and give back the value it holds for `param` (null = nothing readable). Resolves null if cancelled. */
  eyedrop(param: string, kind: string): Promise<number | null>;
  cancelEyedrop(): void;
  /** Let the user click a reference snap in the view; null if cancelled. */
  pickPoint?(): Promise<number[] | null>;
  /** The open form changed (opened or closed). */
  changed?(): void;
}

const PREVIEW_DELAY_MS = 150;
const UNITS: Record<string, string> = { length: "mm", angle: "°", number: "" };

export class ToolPanel {
  private open: ToolInfo | null = null;
  private timer = 0;
  private inputs: Record<string, HTMLInputElement> = {};
  private pairInputs: Record<string, HTMLInputElement[][]> = {}; // per_edge parameters: [start, end] inputs per edge

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
          button.addEventListener("click", () => this.openForm(tool, {}, "drawer"));
          this.listButtons.set(tool.id, button);
          box.append(button);
        }
        return box;
      }),
    );
  }

  get openToolId(): string | null {
    return this.open?.id ?? null;
  }

  get isOpen(): boolean {
    return this.open !== null;
  }

  /** Close the form without committing (the host restores the committed model). */
  close(restore = true) {
    if (!this.open) return;
    if (restore) usage.record(this.open.id, "cancel");
    this.open = null;
    this.host.cancelEyedrop();
    clearTimeout(this.timer);
    this.formEl.hidden = true;
    this.formEl.replaceChildren();
    this.host.changed?.();
    if (restore) this.host.cancel();
  }

  /** Open the form for a tool; `initial` pre-fills values (used to re-edit the last operation). */
  openForm(tool: ToolInfo, initial: Record<string, ParamValue> = {}, surface: Surface = "other") {
    this.close();
    usage.record(tool.id, "start", surface);
    this.open = tool;
    const inputs: Record<string, HTMLInputElement> = {};
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = tool.label;
    const pairInputs: Record<string, HTMLInputElement[][]> = {};
    const rows = tool.params.map((p) => {
      if (p.kind === "per_edge") return this.perEdgeRows(p, initial[p.name], pairInputs);
      const row = document.createElement("label");
      row.className = "row";
      const name = document.createElement("span");
      name.textContent = `${p.name.replace(/_/g, " ")}${UNITS[p.kind] ? ` (${UNITS[p.kind]})` : ""}`;
      const input = document.createElement("input");
      input.type = "number";
      input.step = "any";
      input.value = String(typeof initial[p.name] === "number" ? initial[p.name] : p.default);
      input.addEventListener("input", () => this.schedulePreview());
      input.addEventListener("keydown", (e) => {
        e.stopPropagation(); // typing must not trigger view shortcuts or tools
        if (e.key === "Enter") this.apply();
        else if (e.key === "Escape") this.close();
      });
      inputs[p.name] = input;
      row.append(name, input);
      if (p.kind === "length" || p.kind === "angle") {
        const dropper = document.createElement("button");
        dropper.type = "button";
        dropper.className = "eyedropper";
        dropper.textContent = "⌖";
        dropper.title = "Eyedropper: click a fillet, hole or edge in the model to copy its value";
        dropper.addEventListener("click", async (e) => {
          e.preventDefault();
          dropper.classList.add("armed");
          const value = await this.host.eyedrop(p.name, p.kind);
          dropper.classList.remove("armed");
          if (value !== null && this.open) {
            input.value = String(Math.round(value * 1000) / 1000);
            this.schedulePreview(0);
          }
        });
        row.append(dropper);
      }
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
    const placement = tool.placement;
    if (placement && placement.length === 3 && this.host.pickPoint) {
      const pick = document.createElement("button");
      pick.textContent = "Pick point (origin, axis, face)";
      pick.addEventListener("click", async () => {
        const point = await this.host.pickPoint!();
        if (!point || this.open !== tool) return;
        placement.forEach((name, i) => (inputs[name].value = String(parseFloat(point[i].toFixed(4)))));
        this.schedulePreview(0);
      });
      buttons.before(pick);
    }
    this.formEl.hidden = false;
    this.inputs = inputs;
    this.pairInputs = pairInputs;
    (Object.values(inputs)[0] ?? Object.values(pairInputs)[0]?.[0]?.[0] ?? apply).focus();
    this.schedulePreview(0);
    this.host.changed?.();
  }

  /** One row per selected edge with a start and an end radius (end 0 = constant). */
  private perEdgeRows(p: { name: string; default: number }, initial: ParamValue | undefined, store: Record<string, HTMLInputElement[][]>): HTMLElement {
    const box = document.createElement("div");
    const ids = this.host.selectedEdges?.() ?? [];
    const saved = Array.isArray(initial) ? initial : [];
    const head = document.createElement("div");
    head.className = "row";
    head.textContent = "Radius per edge (mm): start and end; end 0 keeps the radius constant, start 0 leaves the edge sharp";
    box.append(head);
    const pairs: HTMLInputElement[][] = [];
    ids.forEach((id, i) => {
      const row = document.createElement("label");
      row.className = "row";
      const name = document.createElement("span");
      name.textContent = `edge ${id}`;
      const pair = [0, 1].map((k) => {
        const input = document.createElement("input");
        input.type = "number";
        input.step = "any";
        input.min = "0";
        input.title = k === 0 ? "Start radius" : "End radius (0 = same as start)";
        input.value = String(saved[i]?.[k] ?? (k === 0 ? p.default : 0));
        input.addEventListener("input", () => this.schedulePreview());
        input.addEventListener("keydown", (e) => {
          e.stopPropagation();
          if (e.key === "Enter") this.apply();
          else if (e.key === "Escape") this.close();
        });
        return input;
      });
      pairs.push(pair);
      row.append(name, ...pair);
      box.append(row);
    });
    store[p.name] = pairs;
    return box;
  }

  private values(): Record<string, ParamValue> {
    const values: Record<string, ParamValue> = Object.fromEntries(Object.entries(this.inputs).map(([k, el]) => [k, Number(el.value)]));
    for (const [name, pairs] of Object.entries(this.pairInputs)) values[name] = pairs.map((pair) => pair.map((el) => Number(el.value)));
    return values;
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
