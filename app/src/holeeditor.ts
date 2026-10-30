/** The Hole Editor's content: its title, the section buttons, the picture and the preset list. It knows nothing of where it is shown
 *  (a floating card now, a docked panel later); the host passes what happens when a section or a preset is chosen. The values
 *  themselves are the ordinary form of the section's tool, which the host draws under this header. */
import { counterborePresets, countersinkPresets, diameterPresets, threadPresets, type HolePreset } from "./holepresets.ts";
import type { HoleThread } from "./holethread.ts";
import { holeDiagram, type HoleShape } from "./holediagram.ts";

export type HoleKind = "hole" | "holes" | "new";

export interface HoleSection {
  /** The tool this section runs (its form is drawn under the header). */
  tool: string;
  label: string;
  title: string;
  shape: HoleShape;
  thread?: boolean;
  presets?: () => HolePreset[];
}

const SIZE: HoleSection = { tool: "edit_hole", label: "Size & position", title: "Change the diameter, depth, start and position of the hole", shape: "simple", presets: diameterPresets };
const SIZE_ALL: HoleSection = { tool: "resize_hole", label: "Size", title: "Change the diameter of every selected hole", shape: "simple", presets: diameterPresets };

const MOVE_ALL: HoleSection = { tool: "move_hole", label: "Move", title: "Move every selected hole by distances along X, Y and Z", shape: "simple" };
const ALIGN: HoleSection = { tool: "align_holes", label: "Align", title: "Line the holes up with the first one you selected along an axis", shape: "simple" };
const DISTRIBUTE: HoleSection = { tool: "distribute_holes", label: "Distribute", title: "Space the holes evenly between the two outermost along an axis", shape: "simple" };
const COUNTERBORE: HoleSection = { tool: "convert_to_counterbore", label: "Counterbore", title: "Widen the opening into a flat-bottomed step for a screw head", shape: "counterbore", presets: counterborePresets };
const COUNTERSINK: HoleSection = { tool: "convert_to_countersink", label: "Countersink", title: "Cut a cone into the opening for a flat head screw", shape: "countersink", presets: countersinkPresets };
const THREAD: HoleSection = { tool: "thread_hole", label: "Thread", title: "Cut a helical thread into the round wall", shape: "simple", thread: true, presets: threadPresets };
const FILL: HoleSection = { tool: "fill_hole", label: "Fill", title: "Fill the picked round wall with material", shape: "simple" };

/** How the one picked face sits in its hole (the core's `pick`): Thread needs a whole round wall, Fill a round wall. */
export type HolePick = "wall" | "cylinder" | "other";

const NEW_SIMPLE: HoleSection = { tool: "add_hole", label: "Simple", title: "A plain round hole, blind or through", shape: "simple", presets: diameterPresets };
const NEW_COUNTERBORE: HoleSection = { tool: "add_counterbore", label: "Counterbore", title: "A hole with a flat-bottomed step for a screw head", shape: "counterbore", presets: () => counterborePresets(true) };
const NEW_COUNTERSINK: HoleSection = { tool: "add_countersink", label: "Countersink", title: "A hole with a cone-shaped opening for a flat head screw", shape: "countersink", presets: () => countersinkPresets(true) };

/** The sections offered for a selection: a flat face for a new hole, one hole (picked as `pick`; `threadable` when the core finds a bore wall to thread, whichever face of the hole is picked), or several (`count` holes). */
export function sectionsFor(kind: HoleKind, count = 1, pick: HolePick = "other", threadable = pick === "wall"): HoleSection[] {
  if (kind === "new") return [NEW_SIMPLE, NEW_COUNTERBORE, NEW_COUNTERSINK];
  if (kind === "hole") return [SIZE, COUNTERBORE, COUNTERSINK, ...(threadable ? [THREAD] : []), ...(pick !== "other" ? [FILL] : [])];
  return count >= 1 ? [SIZE_ALL, MOVE_ALL, ...(count >= 2 ? [ALIGN] : []), ...(count >= 3 ? [DISTRIBUTE] : []), FILL] : [];
}

export interface HoleEditorDeps {
  sections: HoleSection[];
  /** The tool of the section now shown. */
  active: string;
  choose(section: HoleSection): void;
  /** A preset was chosen: put these values into the form. */
  fill(values: Record<string, number>): void;
  /** A label of the picture was clicked: focus that field. */
  focus(param: string): void;
  /** For a new hole: the thread cut together with it. The list names the standard sizes; `size` is the chosen one (0 = none). */
  thread?: { sizes: string[]; value: HoleThread; change(value: HoleThread): void };
}

export function buildHoleEditor(d: HoleEditorDeps): HTMLElement {
  const box = document.createElement("div");
  const title = document.createElement("div");
  title.className = "title";
  title.textContent = "Hole Editor";
  box.append(title);
  const section = d.sections.find((s) => s.tool === d.active) ?? d.sections[0];
  if (d.sections.length > 1) {
    const tabs = document.createElement("div");
    tabs.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px";
    for (const s of d.sections) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = s.label;
      button.title = s.title;
      button.style.cssText = "text-align:center;margin-top:2px;width:auto;flex:1 1 auto";
      button.classList.toggle("active", s === section);
      button.addEventListener("click", () => d.choose(s));
      tabs.append(button);
    }
    box.append(tabs);
  }
  if (!section) return box;
  const picture = holeDiagram(section.shape, section.thread);
  picture.addEventListener("click", (e) => {
    const param = (e.target as Element).closest("[data-param]")?.getAttribute("data-param");
    if (param) d.focus(param);
  });
  box.append(picture);
  const presets = section.presets?.();
  if (presets?.length) {
    const list = document.createElement("select");
    list.title = "Metric and inch fastener sizes: choosing one fills the fields below";
    list.style.cssText = "width:100%;margin:2px 0 4px";
    list.append(new Option("Fastener presets", ""));
    for (const [system, name] of [["metric", "Metric"], ["inch", "Inch"]] as const) {
      const group = document.createElement("optgroup");
      group.label = name;
      presets.forEach((p, i) => p.system === system && group.append(new Option(p.label, String(i))));
      list.append(group);
    }
    list.addEventListener("change", () => {
      const picked = presets[Number(list.value)];
      list.value = "";
      if (picked) d.fill(picked.values);
    });
    list.addEventListener("keydown", (e) => e.stopPropagation());
    box.append(list);
  }
  if (d.thread) box.append(threadRow(d.thread));
  return box;
}

/** The thread list of a new hole: "No thread" or a standard size, and a left-hand box. */
function threadRow(thread: NonNullable<HoleEditorDeps["thread"]>): HTMLElement {
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:6px;align-items:center;margin:2px 0 4px";
  row.title = "Cut a thread into the new hole's bore when you apply it (one step for the hole and the thread)";
  const list = document.createElement("select");
  list.style.cssText = "flex:1 1 auto";
  list.append(new Option("No thread", "0"));
  thread.sizes.forEach((name, i) => list.append(new Option(`Thread ${name}`, String(i + 1))));
  list.value = String(thread.value.size);
  const left = document.createElement("input");
  left.type = "checkbox";
  left.checked = thread.value.left;
  const label = document.createElement("label");
  label.append(left, " Left hand");
  const send = () => thread.change({ size: Number(list.value), left: left.checked });
  list.addEventListener("change", send);
  left.addEventListener("change", send);
  list.addEventListener("keydown", (e) => e.stopPropagation());
  row.append(list, label);
  return row;
}
