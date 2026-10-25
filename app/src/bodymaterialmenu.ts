// The material choice in the body list's right-click menu, and the densities of bodies that have their own material.
// A body without a choice follows the Default material setting.

import { MATERIALS, getMaterial, materialOrDefault } from "./materials";
import { settings } from "./settings";

/** Label of the menu row that opens the material choices: the body's material, or the default's name. */
export function materialMenuLabel(material: string | null | undefined): string {
  const own = material ? getMaterial(material) : undefined;
  return own ? `Material: ${own.name}...` : `Material: ${materialOrDefault(settings.material).name} (default)...`;
}

/** Fills a menu with "Default" and every material, grouped; the current choice is marked. */
export function appendMaterialChoices(menu: HTMLElement, current: string | null, choose: (material: string | null) => void) {
  const item = (label: string, material: string | null) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.textContent = (material === current || (material === null && !getMaterial(current ?? "")) ? "✓ " : "") + label;
    button.addEventListener("click", () => choose(material));
    menu.append(button);
  };
  item(`Default (${materialOrDefault(settings.material).name})`, null);
  for (const m of MATERIALS) item(m.name, m.id);
}
