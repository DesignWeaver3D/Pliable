/** "All tools" list (grouped by layout.ts) and the parameter form for tools that are not dragged. */
import type { PickOptions } from "./reference";
import { toolIcon } from "./icons";
import { TOOL_GROUPS } from "./layout";
import { toolTooltip, type ToolInfo } from "./tools";
import { moveVector, offsetOf, originFor, pointText, type AnchorInfo, type Vec3 } from "./placepick";
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
  pickPoint?(options?: PickOptions): Promise<number[] | null>;
  /** Keep a marker at the picked base point (null removes it). */
  showBase?(point: number[] | null): void;
  /** The points of a new shape that can be put at the destination (primitives), for the current values. */
  anchors?(tool: ToolInfo, values: Record<string, ParamValue>): Promise<AnchorInfo[]>;
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
          button.append(toolIcon(tool.id, tool.label), tool.label);
          button.disabled = !this.host.usable(tool);
          button.title = toolTooltip(tool);
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
    this.host.showBase?.(null);
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
      const note = document.createElement("div");
      note.className = "row";
      let destination: Vec3 | null = null;
      let offset: Vec3 = [0, 0, 0]; // the picked base point relative to the placement point; zero = the placement point itself
      let picked = false;
      const origin = (): Vec3 => placement.map((n) => parseFloat(inputs[n].value) || 0) as unknown as Vec3;
      const show = () => (note.textContent = `${picked ? "Base picked" : "Base: placement point"}${destination ? `, destination ${pointText(destination)}` : ""}`);
      show();
      const place = () => {
        if (!destination) return;
        originFor(destination, offset).forEach((c, i) => (inputs[placement[i]].value = String(parseFloat(c.toFixed(4)))));
        this.schedulePreview(0);
      };
      const pickDestination = async () => {
        const from = picked ? [0, 1, 2].map((i) => origin()[i] + offset[i]) : undefined;
        const point = await this.host.pickPoint!(from ? { from } : {});
        if (!point || this.open !== tool) return;
        destination = [point[0], point[1], point[2]];
        show();
        place();
        this.host.showBase?.([...destination]);
      };
      const pickBase = document.createElement("button");
      pickBase.textContent = "Pick base point";
      pickBase.title = "Click the point of the new shape (a corner, edge midpoint, face centre or the centre) or any other point (a vertex, edge, axis, hole centre or the origin) that goes to the destination";
      pickBase.addEventListener("click", async () => {
        const list = this.host.anchors ? await this.host.anchors(tool, this.values()) : [];
        if (this.open !== tool) return;
        const at = origin();
        const extra = list.map((a) => ({ point: [at[0] + a.offset[0], at[1] + a.offset[1], at[2] + a.offset[2]], label: a.label }));
        const point = await this.host.pickPoint!({ extra });
        if (!point || this.open !== tool) return;
        offset = offsetOf([point[0], point[1], point[2]], at);
        picked = true;
        this.host.showBase?.(point);
        show();
        place();
        if (!destination) await pickDestination(); // a base alone moves nothing, so go straight on to the destination
      });
      const pick = document.createElement("button");
      pick.textContent = "Pick destination point";
      pick.title = "Click a vertex, edge, face centre, hole centre, axis or the origin; the base point goes there";
      pick.addEventListener("click", () => void pickDestination());
      for (const name of placement)
        inputs[name].addEventListener("input", () => {
          destination = null;
          show();
        });
      buttons.before(pickBase, pick, note);
    }
    const vector = tool.moveVector;
    if (vector && vector.length === 3 && this.host.pickPoint) {
      let base: Vec3 = [0, 0, 0];
      let destination: Vec3 | null = null;
      const note = document.createElement("div");
      note.className = "row";
      const show = () => (note.textContent = `Base ${pointText(base)}${destination ? `, destination ${pointText(destination)}` : ""}`);
      show();
      const apply = () => {
        if (!destination) return;
        moveVector(base, destination).forEach((c, i) => (inputs[vector[i]].value = String(parseFloat(c.toFixed(4)))));
        this.schedulePreview(0);
      };
      const pickDestination = async () => {
        const point = await this.host.pickPoint!();
        if (!point || this.open !== tool) return;
        destination = [point[0], point[1], point[2]];
        show();
        apply();
      };
      const pickBase = document.createElement("button");
      pickBase.textContent = "Pick base point";
      pickBase.title = "Click the point the move starts from (a vertex, edge, face centre, hole centre, axis or the origin); then pick where it goes";
      pickBase.addEventListener("click", async () => {
        const point = await this.host.pickPoint!();
        if (!point || this.open !== tool) return;
        base = [point[0], point[1], point[2]];
        show();
        apply();
        if (!destination) await pickDestination(); // a base alone moves nothing, so go straight on to the destination
      });
      const pickDest = document.createElement("button");
      pickDest.textContent = "Pick destination point";
      pickDest.title = "Click where the base point goes; the move is the destination minus the base (the origin unless a base is picked)";
      pickDest.addEventListener("click", () => void pickDestination());
      for (const name of vector) inputs[name].addEventListener("input", () => ((destination = null), show()));
      buttons.before(pickBase, pickDest, note);
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

  /** Put values into the open form's fields (a drag in the viewport fills them) and refresh the preview. */
  setValues(values: Record<string, number>) {
    for (const [name, value] of Object.entries(values)) if (this.inputs[name]) this.inputs[name].value = String(Math.round(value * 1000) / 1000);
    this.schedulePreview(0);
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
