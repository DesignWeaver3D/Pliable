/** The Hole Editor's content: its title, the section buttons, the picture and the preset list. It knows nothing of where it is shown
 *  (a floating card now, a docked panel later); the host passes what happens when a section or a preset is chosen. The values
 *  themselves are the ordinary form of the section's tool, which the host draws under this header. */
import { diameterPresets, type HolePreset } from "./holepresets.ts";
import { holeDiagram, type HoleShape } from "./holediagram.ts";

export type HoleKind = "hole" | "holes";

export interface HoleSection {
  /** The tool this section runs (its form is drawn under the header). */
  tool: string;
  label: string;
  title: string;
  shape: HoleShape;
  thread?: boolean;
  presets?: () => HolePreset[];
}

const SIZE: HoleSection = { tool: "edit_hole", label: "Size", title: "Change the diameter, depth, start and position of the hole", shape: "simple", presets: diameterPresets };
const SIZE_ALL: HoleSection = { tool: "resize_hole", label: "Size", title: "Change the diameter of every selected hole", shape: "simple", presets: diameterPresets };

/** The sections offered for a selection: one hole, or several (`count` holes). */
export function sectionsFor(kind: HoleKind, count = 1): HoleSection[] {
  return kind === "hole" ? [SIZE] : count >= 1 ? [SIZE_ALL] : [];
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
  return box;
}
