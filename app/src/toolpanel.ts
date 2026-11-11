/** "All tools" list (grouped by layout.ts) and the parameter form for tools that are not dragged. */
import { colourSides } from "./planepicks";
import type { PickOptions } from "./reference";
import { toolIcon } from "./icons";
import { TOOL_GROUPS } from "./layout";
import { toolTooltip, type ToolInfo } from "./tools";
import { type AnchorInfo, type Vec3 } from "./placepick";
import { usage, type Surface } from "./usage";
import { roundValue } from "./precision.ts";
import { fieldNumber, fieldText } from "./numberfield.ts";
import { interaction } from "./interactionlogic.ts";
import { InteractionChoice } from "./interactionchoice.ts";
import type { FormParts } from "./toolformparts.ts";
import { paramRow } from "./toolformrows.ts";
import { placementPicks, moveVectorPicks } from "./toolformplace.ts";
import { axisPointPick, edgeAxisPicks } from "./toolformaxis.ts";
import { planePicks } from "./toolformplane.ts";

/** A parameter value: a number, or for `per_edge` parameters one [start, end] radius pair per selected edge. */
export type ParamValue = number | number[][];

export interface ToolPanelHost {
  /** Ids of the selected edges, in selection order (rows of a `per_edge` parameter). */
  selectedEdges?(): number[];
  tools(): ToolInfo[];
  usable(tool: ToolInfo): boolean;
  /** A tool chosen in the list whose selection does not fit yet: the host makes it wait for one and returns true (the form then does not open). */
  waitFor?(tool: ToolInfo): boolean;
  /** Run the tool with these values without committing (live preview). */
  preview(tool: ToolInfo, values: Record<string, ParamValue>, editBody?: number): Promise<void>;
  commit(tool: ToolInfo, values: Record<string, ParamValue>, editBody?: number): Promise<void>;
  cancel(): void;
  /** Eyedropper: wait for the next click on the model and give back the value it holds for `param` (null = nothing readable). Resolves null if cancelled. */
  eyedrop(param: string, kind: string): Promise<number | null>;
  cancelEyedrop(): void;
  /** Let the user click a reference snap in the view; null if cancelled. */
  pickPoint?(options?: PickOptions): Promise<number[] | null>;
  /** Wait for a click on an edge anywhere on the model and give back a point on it; null if cancelled. */
  pickEdgePoint?(): Promise<number[] | null>;
  /** The id of an edge the user clicks, or null when cancelled (the circular array's axis). */
  pickEdgeId?(): Promise<number | null>;
  /** A plane the user picks (a flat face clicked in the view), or null when cancelled (the mirror's plane). */
  pickPlane?(): Promise<{ origin: number[]; normal: number[] } | null>;
  /** Wait for a click on a vertex, edge or flat face anywhere on the model and give back its id (null when cancelled); `message` is shown in the status line. */
  pickItem?(kind: "vertex" | "edge" | "face", message: string): Promise<number | null>;
  /** The plane the core builds for a sketch_plane request (vertices, edge and vertex, or face with offset and angle), or null with the error shown. */
  planeFrom?(request: Record<string, unknown>): Promise<{ origin: number[]; normal: number[] } | null>;
  /** The datum planes of the model, offered as buttons by tools that take a plane. */
  datumPlanes?(): readonly { name: string; plane: { origin: number[]; normal: number[] } }[];
  /** The kept sketches and the plane of one, offered as buttons by tools that take a plane (see planepicks.ts). */
  sketchList?(): readonly { id: number; name: string }[];
  sketchPlane?(id: number): Promise<{ origin: number[]; normal: number[] } | null>;
  /** Fillet/Chamfer's Two distances button: reopen as Chamfer (two distances) on the first face beside the edge, with this distance for both. */
  twoDistances?(distance: number): void;
  /** Keep a marker at the picked base point (null removes it). */
  showBase?(point: number[] | null): void;
  /** The points of a new shape that can be put at the destination (primitives), for the current values. */
  anchors?(tool: ToolInfo, values: Record<string, ParamValue>): Promise<AnchorInfo[]>;
  /** Called before another tool's form replaces the open one: may ask what to do with it (an unapplied array). */
  settleOpenForm?(): Promise<void>;
  /** The open form changed (opened or closed). */
  changed?(): void;
  /** For a form opened as a card (openForm's `card`): the header drawn in place of the plain title, or null for none. */
  cardHeader?(tool: ToolInfo): HTMLElement | null;
  /** For a card's form: after `changed` was changed (none: the form opened or a preset filled it), the values to force and the fields to hide. */
  cardForm?(tool: ToolInfo, values: Record<string, ParamValue>, changed?: string): { set: Record<string, number>; hidden: string[] } | null;
  /** A tool with no form of its own (the Hole Editor entry) chosen from the list while its selection fits: the host starts it and returns true. */
  startOwn?(tool: ToolInfo): boolean;
}

const PREVIEW_DELAY_MS = 150;

export class ToolPanel {
  private open: ToolInfo | null = null;
  private card = false; // the open form is a card (the Hole Editor): it opens by itself on a selection, so it starts no preview until a value changes
  private previewed = false; // a preview was requested since the form opened (a changed card has something to apply)
  private editBody: number | undefined; // set while an existing primitive body is being edited (its id)
  private timer = 0;
  private inputs: Record<string, HTMLInputElement | HTMLSelectElement> = {};
  private rowOf: Record<string, HTMLElement> = {}; // the row of each field, so a card can hide those a switch makes unneeded
  /** Where the picked base point is now (the move arrows are drawn there); null until a base is picked. */
  private baseNow: (() => Vec3 | null) | null = null;
  private pairInputs: Record<string, HTMLInputElement[][]> = {}; // per_edge parameters: [start, end] inputs per edge

  constructor(
    private readonly listEl: HTMLElement,
    private readonly formEl: HTMLElement,
    readonly host: ToolPanelHost,
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
      for (const [id, button] of this.listButtons) button.classList.toggle("nofit", !this.host.usable(tools.find((t) => t.id === id)!));
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
          button.classList.toggle("nofit", !this.host.usable(tool)); // only dimmed: every tool can be chosen, a misfit one waits for its selection
          button.title = toolTooltip(tool);
          button.addEventListener("click", () => void (this.host.settleOpenForm?.() ?? Promise.resolve()).then(() => {
            if (this.host.waitFor?.(tool)) this.close(); // the open form (if any) is dropped; the tool starts when the selection fits
            else if (!this.host.startOwn?.(tool)) this.openForm(tool, {}, "drawer");
          }));
          this.listButtons.set(tool.id, button);
          box.append(button);
        }
        return box;
      }),
    );
  }

  get openToolLabel(): string {
    return this.open?.label ?? "";
  }

  get openToolId(): string | null {
    return this.open?.id ?? null;
  }

  /** Color the Remove side names like the bodies the open cutting plane would give (from the preview's `sides`). */
  setSideColours(sides: readonly (number | null)[] | undefined) {
    const list = this.inputs.remove_side;
    if (this.open?.id === "cut_plane" && list instanceof HTMLSelectElement) colourSides(list, sides);
  }

  get isOpen(): boolean {
    return this.open !== null;
  }

  /** The open form is a card that opened by itself on a selection (not a tool the user started). */
  get isCard(): boolean {
    return this.open !== null && this.card;
  }

  /** The open form has shown a preview since it opened: a card that opened on a selection and was never changed has not. */
  get hasPreview(): boolean {
    return this.open !== null && this.previewed;
  }

  /** The picked base point's current position, or null (then the tool's own handle positions stand). */
  basePosition(): Vec3 | null {
    return this.baseNow ? this.baseNow() : null;
  }

  /** Close the form without committing (the host restores the committed model). */
  close(restore = true) {
    if (!this.open) return;
    if (restore) usage.record(this.open.id, "cancel");
    this.open = null;
    this.card = false;
    this.previewed = false;
    this.baseNow = null;
    this.editBody = undefined;
    this.host.cancelEyedrop();
    this.host.showBase?.(null);
    clearTimeout(this.timer);
    this.formEl.hidden = true;
    this.formEl.replaceChildren();
    interaction.reset(); // the body interaction choice is forgotten
    this.host.changed?.();
    if (restore) this.host.cancel();
  }

  /** Open the form for a tool; `initial` pre-fills values (used to re-edit the last operation). */
  openForm(tool: ToolInfo, initial: Record<string, ParamValue> = {}, surface: Surface = "other", editBody?: number, card = false) {
    this.close();
    usage.record(tool.id, "start", surface);
    this.open = tool;
    this.card = card;
    this.previewed = false;
    this.editBody = editBody;
    this.baseNow = null;
    const inputs: Record<string, HTMLInputElement | HTMLSelectElement> = {};
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = editBody === undefined ? tool.label : `Edit ${tool.label.replace(/^Add /, "").toLowerCase()}`;
    const pairInputs: Record<string, HTMLInputElement[][]> = {};
    const rowOf: Record<string, HTMLElement> = {};
    const buttons = document.createElement("div");
    const parts: FormParts = {
      tool, host: this.host, initial, card, inputs, pairInputs, rowOf, title, buttons, baseNow: null,
      isOpen: () => this.open === tool,
      anyOpen: () => this.open !== null,
      preview: (delay) => this.schedulePreview(delay),
      values: () => this.values(),
      refreshCard: (changed) => this.refreshCard(changed),
      apply: () => void this.apply(),
      close: () => this.close(),
    };
    const rows = tool.params.map((p) => paramRow(parts, p));
    const apply = document.createElement("button");
    apply.textContent = "Apply";
    apply.addEventListener("click", () => this.apply());
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => this.close());
    buttons.className = "buttons";
    buttons.append(apply, cancel);
    if (tool.id === "fillet_chamfer" && editBody === undefined && this.host.twoDistances) {
      const two = document.createElement("button");
      two.textContent = "Two distances";
      two.title = "Bevel with a different distance on each side: reopens as Chamfer (two distances), with the first face beside the edge as the reference";
      two.addEventListener("click", () => this.host.twoDistances!(fieldNumber(inputs.distance as HTMLInputElement) ?? 0));
      buttons.prepend(two);
    }
    const header = card ? (this.host.cardHeader?.(tool) ?? null) : null;
    interaction.setReport(null); // a new tool: the last tool's setting no longer applies
    const choice = new InteractionChoice(() => this.schedulePreview(0));
    choice.setTool(tool.interaction);
    this.formEl.replaceChildren(header ?? title, ...rows, choice.el, buttons);
    placementPicks(parts);
    moveVectorPicks(parts);
    axisPointPick(parts);
    edgeAxisPicks(parts);
    planePicks(parts);
    this.baseNow = parts.baseNow;
    this.formEl.hidden = false;
    this.inputs = inputs;
    this.rowOf = rowOf;
    this.pairInputs = pairInputs;
    this.refreshCard();
    (Object.values(inputs)[0] ?? Object.values(pairInputs)[0]?.[0]?.[0] ?? apply).focus();
    if (!card) this.schedulePreview(0); // a card shows the unchanged model until a value changes
    this.host.changed?.();
  }

  /** Move the cursor to one field of the open form (a label of the Hole Editor's picture was clicked). */
  focusField(name: string) {
    this.inputs[name]?.focus();
  }

  /** Put values into the open form's fields (a drag in the viewport fills them) and refresh the preview. */
  setValues(values: Record<string, number>) {
    for (const [name, value] of Object.entries(values)) if (this.inputs[name]) this.inputs[name].value = fieldText(roundValue(value));
    this.refreshCard();
    this.schedulePreview(0);
  }

  /** A card's form after a field changed: apply the values its host forces and hide the rows it says are not needed. */
  private refreshCard(changed?: string) {
    const tool = this.open;
    if (!tool || !this.card) return;
    const answer = this.host.cardForm?.(tool, this.values(), changed);
    if (!answer) return;
    for (const [name, value] of Object.entries(answer.set)) if (this.inputs[name]) this.inputs[name].value = fieldText(value);
    const hidden = new Set(answer.hidden);
    for (const [name, row] of Object.entries(this.rowOf)) row.style.display = hidden.has(name) ? "none" : "";
  }

  private values(): Record<string, ParamValue> {
    const values: Record<string, ParamValue> = Object.fromEntries(Object.entries(this.inputs).map(([k, el]) => [k, fieldNumber(el) ?? 0]));
    for (const [name, pairs] of Object.entries(this.pairInputs)) values[name] = pairs.map((pair) => pair.map((el) => fieldNumber(el) ?? 0));
    return values;
  }

  private schedulePreview(delay = PREVIEW_DELAY_MS) {
    clearTimeout(this.timer);
    const tool = this.open;
    if (!tool) return;
    this.previewed = true;
    this.timer = window.setTimeout(() => this.host.preview(tool, this.values(), this.editBody), delay);
  }

  /** Applies the open form (the same as its Apply button). */
  async apply() {
    const tool = this.open;
    if (!tool) return;
    const values = this.values();
    const editBody = this.editBody;
    this.close(false);
    await this.host.commit(tool, values, editBody);
  }
}
