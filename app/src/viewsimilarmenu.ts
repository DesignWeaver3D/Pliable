/** The right-click menu of the 3D view: select the faces or edges like the selected one, or the parent bodies. */
import { parentBodies, similarTo, type SimilarKind } from "./selfilter.ts";
import type { Sel } from "./viewport.ts";
import { selectItems } from "./viewselection.ts";
import type { Viewport } from "./viewport.ts";

/** The part of the Viewport this file uses. */
export type SimilarMenuContext = Pick<Viewport, "centreDots" | "centresShown" | "data" | "hoverLine" | "hoverMark" | "hovered" | "markSource" | "mesh" | "model" | "onHoverBody" | "onSelect" | "originAxisHalf" | "relatedMarks" | "renderer" | "selected" | "selectedLine" | "selectedMarks" | "similarMenu">;

export function closeSimilarMenu(view: SimilarMenuContext) {
  view.similarMenu?.remove();
  view.similarMenu = null;
}

/** Right click with one face or edge selected: a small menu of "select similar" choices. */
export function openSimilarMenu(view: SimilarMenuContext, x: number, y: number) {
  closeSimilarMenu(view);
  const data = view.data;
  const only = view.selected.length === 1 ? view.selected[0] : null;
  const owned = view.selected.length > 0 && view.selected.every((s) => s.kind !== "body");
  if (!data || !owned) return;
  const choices: [string, SimilarKind][] = !only ? [] : only.kind === "face" ? [["Select faces facing the same way", "faceDirection"], ["Select faces of the same area", "faceArea"]] : only.kind === "edge" ? [["Select edges of the same length", "edgeLength"]] : [];
  const menu = document.createElement("div");
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:20;display:flex;flex-direction:column;background:#2b2b2b;color:#eee;font:13px sans-serif;border:1px solid #555;border-radius:6px;padding:4px`;
  for (const [label, kind] of choices) {
    const button = document.createElement("button");
    button.textContent = label;
    button.style.cssText = "text-align:left;background:none;color:inherit;border:0;padding:5px 10px;cursor:pointer";
    button.onclick = () => {
      const ids = similarTo(data, kind, only!.id);
      closeSimilarMenu(view);
      const next: Sel[] = ids.map((id) => ({ kind: only!.kind, id }));
      selectItems(view, next);
      view.onSelect(next);
    };
    menu.append(button);
  }
  const parents = document.createElement("button");
  parents.textContent = "Select parent bodies";
  parents.style.cssText = "text-align:left;background:none;color:inherit;border:0;padding:5px 10px;cursor:pointer";
  parents.onclick = () => {
    const next: Sel[] = parentBodies(data, view.selected).map((id) => ({ kind: "body", id }));
    closeSimilarMenu(view);
    selectItems(view, next);
    view.onSelect(next);
  };
  menu.append(parents);
  document.body.appendChild(menu);
  view.similarMenu = menu;
}
