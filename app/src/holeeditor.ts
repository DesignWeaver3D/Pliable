/** The Hole Editor's content: its title, the section buttons, the picture and the preset list. It knows nothing of where it is shown
 *  (a floating card now, a docked panel later); the host passes what happens when a section or a preset is chosen. The values
 *  themselves are the ordinary form of the section's tool, which the host draws under this header. A new hole or one hole is one
 *  form (the Hole features tool: size, counterbore, countersink, thread); Fill is a separate section. */
import { diameterPresets, type HolePreset } from "./holepresets.ts";
import { featurePresets, FEATURES_TOOL, type HoleFeatures } from "./holefeatures.ts";
import { holeDiagram } from "./holediagram.ts";

export type HoleKind = "hole" | "holes" | "new";

export interface HoleSection {
  /** The tool this section runs (its form is drawn under the header). */
  tool: string;
  label: string;
  title: string;
  /** The preset list; `threadNames` are the standard thread sizes of the core's thread list. */
  presets?: (threadNames: string[]) => HolePreset[];
}

const FEATURES: HoleSection = { tool: FEATURES_TOOL, label: "Hole", title: "Size, counterbore, countersink, thread and position of the hole, applied together", presets: featurePresets };
const SIZE_ALL: HoleSection = { tool: "resize_hole", label: "Size", title: "Change the diameter of every selected hole", presets: diameterPresets };

const MOVE_ALL: HoleSection = { tool: "move_hole", label: "Move", title: "Move every selected hole by distances along X, Y and Z" };
const ALIGN: HoleSection = { tool: "align_holes", label: "Align", title: "Line the holes up with the first one you selected along an axis" };
const DISTRIBUTE: HoleSection = { tool: "distribute_holes", label: "Distribute", title: "Space the holes evenly between the two outermost along an axis" };
const FILL: HoleSection = { tool: "fill_hole", label: "Fill", title: "Fill the picked round wall with material" };

/** How the one picked face sits in its hole (the core's `pick`): Fill needs a round wall. */
export type HolePick = "wall" | "cylinder" | "other";

/** The sections offered for a selection: a flat face for a new hole (one form), one hole (picked as `pick`: its one form, and Fill when a round wall was picked), or several (`count` holes). */
export function sectionsFor(kind: HoleKind, count = 1, pick: HolePick = "other"): HoleSection[] {
  if (kind === "new") return [FEATURES];
  if (kind === "hole") return [FEATURES, ...(pick !== "other" ? [FILL] : [])];
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
  /** The standard sizes of the thread list, for the presets. */
  threadNames: string[];
}

/** The built header and a way to redraw its picture for the features now switched on. */
export interface HoleEditorView {
  element: HTMLElement;
  draw(features: HoleFeatures): void;
}

const NONE: HoleFeatures = { bore: null, sink: null, thread: false };
const HINT = "A counterbore and a countersink can't share an end: the one switched on last replaces the other (on a through hole, put one at the far end).";

export function buildHoleEditor(d: HoleEditorDeps): HoleEditorView {
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
  const view: HoleEditorView = { element: box, draw: () => {} };
  if (!section) return view;
  let picture = holeDiagram(NONE);
  const click = (e: Event) => {
    const param = (e.target as Element).closest("[data-param]")?.getAttribute("data-param");
    if (param) d.focus(param);
  };
  picture.addEventListener("click", click);
  box.append(picture);
  view.draw = (features) => {
    const next = holeDiagram(features);
    next.addEventListener("click", click);
    picture.replaceWith(next);
    picture = next;
  };
  const presets = section.presets?.(d.threadNames);
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
  if (section.tool === FEATURES_TOOL) {
    const hint = document.createElement("div");
    hint.className = "row";
    hint.style.cssText = "font-size:11px;opacity:0.75;margin:2px 0 4px";
    hint.textContent = HINT;
    box.append(hint);
  }
  return view;
}
