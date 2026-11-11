/** The rows of a tool form: one per parameter (a choice list or a number with its eyedropper and standard sizes), and the per-edge radius rows. */
import { uiIcon } from "./icons.ts";
import type { ToolInfo } from "./tools.ts";
import { roundValue } from "./precision.ts";
import { COUNTERSINK_ANGLES, hasAngles, hasSizes, holeSizes } from "./holesizes.ts";
import { PARAM_HELP, TOOL_PARAM_HELP } from "./toolparamhelp.ts";
import { numericField, fieldText } from "./numberfield.ts";
import type { ParamValue } from "./toolpanel.ts";
import type { FormParts } from "./toolformparts.ts";

const UNITS: Record<string, string> = { length: "mm", angle: "Â°", number: "" };

/** The row of one parameter of the open tool. */
export function paramRow(f: FormParts, p: ToolInfo["params"][number]) {
  const { tool, inputs, rowOf, pairInputs, initial, card } = f;
  if (p.kind === "per_edge") return perEdgeRows(f, p, initial[p.name], pairInputs);
  const row = document.createElement("label");
  row.className = "row";
  rowOf[p.name] = row;
  const name = document.createElement("span");
  const help = TOOL_PARAM_HELP[tool.id]?.[p.name] ?? PARAM_HELP[p.name];
  name.textContent = help?.label ?? `${p.name.replace(/_/g, " ")}${UNITS[p.kind] ? ` (${UNITS[p.kind]})` : ""}`;
  if (help) row.title = help.title;
  if (p.options) {
    const list = document.createElement("select");
    p.options.forEach((label, i) => list.append(new Option(label, String(i))));
    list.value = String(typeof initial[p.name] === "number" ? initial[p.name] : p.default);
    list.addEventListener("change", () => {
      f.refreshCard(p.name);
      f.preview(0);
    });
    list.addEventListener("keydown", (e) => {
      e.stopPropagation(); // typing must not trigger view shortcuts or tools
      if (e.key === "Enter") f.apply();
      else if (e.key === "Escape") f.close();
    });
    inputs[p.name] = list;
    row.append(name, list);
    return row;
  }
  const input = document.createElement("input");
  numericField(input);
  input.value = fieldText(typeof initial[p.name] === "number" ? (initial[p.name] as number) : p.default);
  input.addEventListener("input", () => {
    f.refreshCard(p.name);
    f.preview();
  });
  input.addEventListener("keydown", (e) => {
    e.stopPropagation(); // typing must not trigger view shortcuts or tools
    if (e.key === "Enter") f.apply();
    else if (e.key === "Escape") f.close();
  });
  inputs[p.name] = input;
  row.append(name, input);
  // The label stays left on one line; the eyedropper icon (and the sizes list) sit just left of the value box, which is at the right edge.
  if (p.kind === "length" || p.kind === "angle") {
    const dropper = document.createElement("button");
    dropper.type = "button";
    dropper.className = "eyedropper";
    dropper.append(uiIcon("eyedropper", 16));
    dropper.setAttribute("aria-label", "Eyedropper");
    dropper.title = "Eyedropper: click a fillet, hole or edge in the model to copy its value";
    dropper.addEventListener("click", async (e) => {
      e.preventDefault();
      dropper.classList.add("armed");
      const value = await f.host.eyedrop(p.name, p.kind);
      dropper.classList.remove("armed");
      if (value !== null && f.anyOpen()) {
        input.value = fieldText(roundValue(value));
        f.preview(0);
      }
    });
    input.before(dropper);
  }
  if (!card && hasSizes(tool.id, p.name)) { // a card has its own fastener presets in its header
    const sizes = document.createElement("select");
    sizes.className = "sizes";
    sizes.title = "Standard sizes: metric clearance and tap drill diameters";
    sizes.append(new Option("Sizes", ""));
    holeSizes(p.name).forEach((size, i) => sizes.append(new Option(`${size.label} (${size.diameter})`, String(i))));
    sizes.addEventListener("change", () => {
      const size = holeSizes(p.name)[Number(sizes.value)];
      sizes.value = "";
      if (!size) return;
      input.value = fieldText(size.diameter);
      f.preview(0);
    });
    sizes.addEventListener("keydown", (e) => e.stopPropagation());
    input.before(sizes);
  }
  if (hasAngles(tool.id, p.name)) {
    const angles = document.createElement("select");
    angles.className = "sizes";
    angles.style.width = "64px";
    angles.title = "Standard countersink head angles (the full included angle)";
    angles.append(new Option("Angles", ""));
    COUNTERSINK_ANGLES.forEach((a, i) => angles.append(new Option(a.label, String(i))));
    angles.addEventListener("change", () => {
      const picked = COUNTERSINK_ANGLES[Number(angles.value)];
      angles.value = "";
      if (!picked) return;
      input.value = fieldText(picked.angle);
      f.preview(0);
    });
    angles.addEventListener("keydown", (e) => e.stopPropagation());
    input.before(angles);
  }
  return row;
}

/** One row per selected edge with a start and an end radius (end 0 = constant). */
export function perEdgeRows(f: FormParts, p: { name: string; default: number }, initial: ParamValue | undefined, store: Record<string, HTMLInputElement[][]>): HTMLElement {
  const box = document.createElement("div");
  const ids = f.host.selectedEdges?.() ?? [];
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
      numericField(input);
      input.title = k === 0 ? "Start radius" : "End radius (0 = same as start)";
      input.value = fieldText(saved[i]?.[k] ?? (k === 0 ? p.default : 0));
      input.addEventListener("input", () => f.preview());
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") f.apply();
        else if (e.key === "Escape") f.close();
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
