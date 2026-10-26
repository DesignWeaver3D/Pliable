/** "All tools" list (grouped by layout.ts) and the parameter form for tools that are not dragged. */
import { colourSides, planeButtons } from "./planepicks";
import type { PickOptions } from "./reference";
import { toolIcon } from "./icons";
import { TOOL_GROUPS } from "./layout";
import { toolTooltip, type ToolInfo } from "./tools";
import { moveVector, offsetOf, originFor, pointText, type AnchorInfo, type Vec3 } from "./placepick";
import { usage, type Surface } from "./usage";
import { roundValue, showNumber } from "./precision.ts";
import { hasSizes, holeSizes } from "./holesizes.ts";

/** A parameter value: a number, or for `per_edge` parameters one [start, end] radius pair per selected edge. */
export type ParamValue = number | number[][];

export interface ToolPanelHost {
  /** Ids of the selected edges, in selection order (rows of a `per_edge` parameter). */
  selectedEdges?(): number[];
  tools(): ToolInfo[];
  usable(tool: ToolInfo): boolean;
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
}

const PREVIEW_DELAY_MS = 150;
const UNITS: Record<string, string> = { length: "mm", angle: "°", number: "" };
/** Form fields whose bare name is unclear: a fuller label and a tooltip. */
const PARAM_HELP: Record<string, { label: string; title: string }> = {
  axis_edge: { label: "axis edge (id, set by Pick axis edge)", title: "The edge the copies turn about when the axis is Picked edge; use the Pick axis edge button rather than typing." },
  new_body: { label: "new body (1 = separate, 0 = join)", title: "1 keeps the new solid as its own body. 0 fuses it into the bodies it touches, which only shows when it overlaps or touches one." },
};

export class ToolPanel {
  private open: ToolInfo | null = null;
  private editBody: number | undefined; // set while an existing primitive body is being edited (its id)
  private timer = 0;
  private inputs: Record<string, HTMLInputElement | HTMLSelectElement> = {};
  /** Where the picked base point is now (the move arrows are drawn there); null until a base is picked. */
  private baseNow: (() => Vec3 | null) | null = null;
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
          button.addEventListener("click", () => void (this.host.settleOpenForm?.() ?? Promise.resolve()).then(() => this.openForm(tool, {}, "drawer")));
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

  /** Colour the Remove side names like the bodies the open cutting plane would give (from the preview's `sides`). */
  setSideColours(sides: readonly (number | null)[] | undefined) {
    const list = this.inputs.remove_side;
    if (this.open?.id === "cut_plane" && list instanceof HTMLSelectElement) colourSides(list, sides);
  }

  get isOpen(): boolean {
    return this.open !== null;
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
    this.baseNow = null;
    this.editBody = undefined;
    this.host.cancelEyedrop();
    this.host.showBase?.(null);
    clearTimeout(this.timer);
    this.formEl.hidden = true;
    this.formEl.replaceChildren();
    this.host.changed?.();
    if (restore) this.host.cancel();
  }

  /** Open the form for a tool; `initial` pre-fills values (used to re-edit the last operation). */
  openForm(tool: ToolInfo, initial: Record<string, ParamValue> = {}, surface: Surface = "other", editBody?: number) {
    this.close();
    usage.record(tool.id, "start", surface);
    this.open = tool;
    this.editBody = editBody;
    this.baseNow = null;
    const inputs: Record<string, HTMLInputElement | HTMLSelectElement> = {};
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = editBody === undefined ? tool.label : `Edit ${tool.label.replace(/^Add /, "").toLowerCase()}`;
    const pairInputs: Record<string, HTMLInputElement[][]> = {};
    const rows = tool.params.map((p) => {
      if (p.kind === "per_edge") return this.perEdgeRows(p, initial[p.name], pairInputs);
      const row = document.createElement("label");
      row.className = "row";
      const name = document.createElement("span");
      const help = PARAM_HELP[p.name];
      name.textContent = help?.label ?? `${p.name.replace(/_/g, " ")}${UNITS[p.kind] ? ` (${UNITS[p.kind]})` : ""}`;
      if (help) row.title = help.title;
      if (p.options) {
        const list = document.createElement("select");
        p.options.forEach((label, i) => list.append(new Option(label, String(i))));
        list.value = String(typeof initial[p.name] === "number" ? initial[p.name] : p.default);
        list.addEventListener("change", () => this.schedulePreview(0));
        list.addEventListener("keydown", (e) => {
          e.stopPropagation(); // typing must not trigger view shortcuts or tools
          if (e.key === "Enter") this.apply();
          else if (e.key === "Escape") this.close();
        });
        inputs[p.name] = list;
        row.append(name, list);
        return row;
      }
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
            input.value = String(roundValue(value));
            this.schedulePreview(0);
          }
        });
        row.append(dropper);
      }
      if (hasSizes(tool.id, p.name)) {
        const sizes = document.createElement("select");
        sizes.className = "sizes";
        sizes.title = "Standard sizes: metric clearance and tap drill diameters";
        sizes.append(new Option("Sizes", ""));
        holeSizes(p.name).forEach((size, i) => sizes.append(new Option(`${size.label} (${size.diameter})`, String(i))));
        sizes.addEventListener("change", () => {
          const size = holeSizes(p.name)[Number(sizes.value)];
          sizes.value = "";
          if (!size) return;
          input.value = String(size.diameter);
          this.schedulePreview(0);
        });
        sizes.addEventListener("keydown", (e) => e.stopPropagation());
        row.append(sizes);
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
    if (tool.id === "fillet_chamfer" && editBody === undefined && this.host.twoDistances) {
      const two = document.createElement("button");
      two.textContent = "Two distances";
      two.title = "Bevel with a different distance on each side: reopens as Chamfer (two distances), with the first face beside the edge as the reference";
      two.addEventListener("click", () => this.host.twoDistances!(parseFloat((inputs.distance as HTMLInputElement).value) || 0));
      buttons.prepend(two);
    }
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
      this.baseNow = () => {
        if (!picked) return null;
        const at = origin();
        return [at[0] + offset[0], at[1] + offset[1], at[2] + offset[2]];
      };
      const place = () => {
        if (!destination) return;
        originFor(destination, offset).forEach((c, i) => (inputs[placement[i]].value = showNumber(c, 4)));
        this.schedulePreview(0);
      };
      const pickDestination = async () => {
        const from = picked ? [0, 1, 2].map((i) => origin()[i] + offset[i]) : undefined;
        const point = await this.host.pickPoint!(from ? { from } : {});
        if (!point || this.open !== tool) return;
        destination = [point[0], point[1], point[2]];
        show();
        place();
        this.host.showBase?.(null); // the move arrows now mark the base point
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
        this.schedulePreview(0); // the arrows move to the base
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
      let picked = false;
      this.baseNow = () => {
        if (!picked) return null;
        const v = vector.map((n) => parseFloat(inputs[n].value) || 0);
        return [base[0] + v[0], base[1] + v[1], base[2] + v[2]];
      };
      const apply = () => {
        if (!destination) return;
        moveVector(base, destination).forEach((c, i) => (inputs[vector[i]].value = showNumber(c, 4)));
        this.schedulePreview(0);
      };
      const pickDestination = async () => {
        const point = await this.host.pickPoint!();
        if (!point || this.open !== tool) return;
        destination = [point[0], point[1], point[2]];
        show();
        apply();
        this.host.showBase?.(null);
      };
      const pickBase = document.createElement("button");
      pickBase.textContent = "Pick base point";
      pickBase.title = "Click the point the move starts from (a vertex, edge, face centre, hole centre, axis or the origin); then pick where it goes";
      pickBase.addEventListener("click", async () => {
        const point = await this.host.pickPoint!();
        if (!point || this.open !== tool) return;
        base = [point[0], point[1], point[2]];
        picked = true;
        this.host.showBase?.(point);
        show();
        apply();
        this.schedulePreview(0);
        if (!destination) await pickDestination(); // a base alone moves nothing, so go straight on to the destination
      });
      const pickDest = document.createElement("button");
      pickDest.textContent = "Pick destination point";
      pickDest.title = "Click where the base point goes; the move is the destination minus the base (the origin unless a base is picked)";
      pickDest.addEventListener("click", () => void pickDestination());
      for (const name of vector) inputs[name].addEventListener("input", () => ((destination = null), show()));
      buttons.before(pickBase, pickDest, note);
    }
    const axis = tool.pickAxis;
    if (axis && axis.length === 4 && (this.host.pickEdgePoint || this.host.pickPoint)) {
      const pickAxis = document.createElement("button");
      pickAxis.textContent = "Pick axis";
      pickAxis.title = "Click an edge anywhere on the model (the face's own edge or another): the face pivots about the plane through that edge, square to the pull direction (the default is the face's own centroid)";
      pickAxis.addEventListener("click", async () => {
        const point = await (this.host.pickEdgePoint ?? this.host.pickPoint)!();
        if (!point || this.open !== tool) return;
        axis.slice(0, 3).forEach((name, i) => (inputs[name].value = showNumber(point[i], 4)));
        inputs[axis[3]].value = "1"; // the choice list: picked point
        this.schedulePreview(0);
      });
      buttons.before(pickAxis);
    }
    const edgeAxis = tool.pickEdge;
    if (edgeAxis && edgeAxis.length === 2 && this.host.pickEdgeId) {
      const pickEdge = document.createElement("button");
      pickEdge.textContent = "Pick axis edge";
      pickEdge.title = "Click a straight edge (the copies turn about its line) or a circular edge (about the circle's axis) anywhere on the model";
      pickEdge.addEventListener("click", async () => {
        const id = await this.host.pickEdgeId!();
        if (id === null || this.open !== tool) return;
        inputs[edgeAxis[0]].value = String(id);
        inputs[edgeAxis[1]].value = "3"; // the choice list: picked edge
        this.schedulePreview(0);
      });
      buttons.before(pickEdge);
    }
    const planeNames = tool.pickPlane;
    if (planeNames && (planeNames.length === 7 || planeNames.length === 5) && this.host.pickPlane) {
      const usePlaneIn = (origin: number[], normal: number[]) => {
        if (planeNames.length === 7) {
          planeNames.slice(0, 3).forEach((name, i) => (inputs[name].value = showNumber(origin[i], 4)));
          planeNames.slice(3, 6).forEach((name, i) => (inputs[name].value = showNumber(normal[i], 6)));
          inputs[planeNames[6]].value = "4"; // the choice list: picked plane
        } else {
          // A plane given as a distance along its direction: position, nx, ny, nz and the axis choice (3 = the direction nx, ny, nz); tilts start again from the picked plane.
          const length = Math.hypot(normal[0], normal[1], normal[2]) || 1;
          const n = normal.map((c) => c / length);
          inputs[planeNames[0]].value = showNumber(n[0] * origin[0] + n[1] * origin[1] + n[2] * origin[2], 4);
          planeNames.slice(1, 4).forEach((name, i) => (inputs[name].value = showNumber(n[i], 6)));
          inputs[planeNames[4]].value = "3";
          for (const tilt of ["tilt_u", "tilt_v"]) if (inputs[tilt]) inputs[tilt].value = "0";
        }
        this.schedulePreview(0);
      };
      const pickPlane = document.createElement("button");
      pickPlane.textContent = "Pick plane";
      pickPlane.title = "Click a flat face anywhere on the model to use its plane (use this when the tool was started with the wrong face selected)";
      pickPlane.addEventListener("click", async () => {
        const plane = await this.host.pickPlane!();
        if (plane && this.open === tool) usePlaneIn(plane.origin, plane.normal);
      });
      const datums = (this.host.datumPlanes?.() ?? []).map((d) => {
        const button = document.createElement("button");
        button.textContent = `Datum: ${d.name}`;
        button.title = `Use the datum plane ${d.name}`;
        button.addEventListener("click", () => usePlaneIn(d.plane.origin, d.plane.normal));
        return button;
      });
      buttons.before(pickPlane, ...datums, ...planeButtons(this.host, usePlaneIn));
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
    for (const [name, value] of Object.entries(values)) if (this.inputs[name]) this.inputs[name].value = String(roundValue(value));
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
