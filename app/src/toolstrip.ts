/** The strip at the top centre of the view: the tools that work with the selection (or, in a sketch, the drawing tools
 *  and a row of constraints), fitted to the room between the bodies list and the nav cube. Moved out of main.ts. */
import { fitStripCount, stripRoom } from "./stripfit";
import { sketchIcon, toolIcon, uiIcon } from "./icons";
import { TOOL_GROUPS } from "./layout";
import { toolTooltip, type ToolInfo } from "./tools";
import type { Sel } from "./viewport";
import { SKETCH_TOOLS, type Tool as SketchTool } from "./sketch";

export interface StripDeps {
  toolbar: HTMLElement;
  /** A sketch is open (the strip then holds the sketch tools). */
  sketchOpen(): boolean;
  sketchTool(): SketchTool;
  chooseSketchTool(tool: SketchTool): void;
  sketchConstraints(): { label: string; enabled: boolean }[];
  chooseConstraint(label: string): void;
  drawerHidden(): boolean;
  toggleDrawer(open?: boolean, usableOnly?: boolean): void;
  selection(): Sel[];
  usableTools(): ToolInfo[];
  dragToolFor(sels: Sel[]): ToolInfo | null;
  helperSignature(): string;
  selectionHelpers(): HTMLButtonElement[];
  renderChips(): void;
  armTool(tool: ToolInfo): void;
}

/** Strip order: the tool a drag runs first, then the tool groups' order. */
const GROUP_ORDER = TOOL_GROUPS.flatMap((g) => g.tools);

/** Room for the context strip: from the edge of the bodies list to the nav cube group. */
function stripWidthAvailable(d: StripDeps): { width: number; centre: number } {
  const vw = document.documentElement.clientWidth;
  const list = document.getElementById("bodypanel")!.getBoundingClientRect();
  const left = list.width > 0 ? list.right + STRIP_MARGIN_PX : d.drawerHidden() ? LEFT_RESERVE_PX : DRAWER_RESERVE_PX;
  const cube = document.getElementById("navcube")!.getBoundingClientRect();
  const right = cube.width > 0 ? vw - cube.left + STRIP_MARGIN_PX : 160;
  return stripRoom(vw, left, right);
}
const STRIP_MARGIN_PX = 8;
const DRAWER_RESERVE_PX = 532; // list, drawer and its handle
const LEFT_RESERVE_PX = 240;

export function createToolStrip(d: StripDeps) {
  let toolbarKey = "";

  function renderSketchStrip() {
    const room = stripWidthAvailable(d);
    const available = Math.round(room.width);
    const centre = Math.round(room.centre);
    const tool = d.sketchTool();
    const choices = d.sketchConstraints();
    const key = `sketch|${tool}|${available}|${centre}|${choices.map((c) => `${c.label}${c.enabled ? 1 : 0}`).join()}`;
    if (key === toolbarKey) return;
    toolbarKey = key;
    d.toolbar.classList.add("sketching");
    d.toolbar.style.maxWidth = `${available}px`;
    d.toolbar.style.width = `${available}px`; // the whole room, so a row fills before the next one starts
    d.toolbar.style.left = `${centre - Math.round(available / 2)}px`;
    d.toolbar.replaceChildren(
      ...SKETCH_TOOLS.map((t) => {
        const button = document.createElement("button");
        const label = document.createElement("span");
        label.className = "label";
        label.textContent = t.label;
        button.append(sketchIcon(t.id), label);
        button.title = `${t.label}: ${t.hint}`;
        button.className = t.id === tool ? "active" : "";
        button.addEventListener("click", () => d.chooseSketchTool(t.id));
        return button;
      }),
      // The second row: every constraint and dimension, always available; the title says whether the selection fits (`enabled` is kept for that).
      Object.assign(document.createElement("div"), { className: "rowbreak" }),
      ...choices.map((c) => {
        const button = document.createElement("button");
        button.textContent = c.label;
        button.title = c.enabled ? `Apply ${c.label} to the selection` : `${c.label}: does not fit the current selection`;
        button.addEventListener("click", () => d.chooseConstraint(c.label));
        return button;
      }),
    );
  }

  function renderToolbar() {
    if (d.sketchOpen()) {
      renderSketchStrip(); // a sketch is open
      return;
    }
    d.toolbar.classList.remove("sketching");
    d.renderChips();
    const usable = d.usableTools();
    const active = d.dragToolFor(d.selection())?.id;
    const helperKey = d.helperSignature();
    const room = stripWidthAvailable(d);
    const available = Math.round(room.width);
    const centre = Math.round(room.centre);
    const key = `${usable.map((t) => t.id).join(",")}|${active}|${d.selection().length}|${helperKey}|${available}|${centre}`;
    if (key === toolbarKey) return; // unchanged: keep the buttons (avoids flicker as the core's replies arrive)
    toolbarKey = key;
    d.toolbar.style.maxWidth = `${available}px`;
    d.toolbar.style.width = `${available}px`; // the whole room, so a row fills before the next one starts
    d.toolbar.style.left = `${centre - Math.round(available / 2)}px`;
    const helpers = d.selectionHelpers();
    if (usable.length === 0 && helpers.length === 0) {
      const hint = document.createElement("span");
      hint.className = "none";
      hint.textContent = d.selection().length ? "No tools for this selection" : "Select a face or edge (Ctrl+K for commands)";
      const browse = document.createElement("button");
      browse.append(uiIcon("more"), "... More");
      browse.className = "more";
      browse.title = "Open the tool drawer (T)";
      browse.addEventListener("click", () => d.toggleDrawer(true));
      d.toolbar.replaceChildren(hint, browse);
      return;
    }
    const rank = (t: ToolInfo) => (t.id === active ? -1 : GROUP_ORDER.includes(t.id) ? GROUP_ORDER.indexOf(t.id) : GROUP_ORDER.length);
    const ordered = [...usable].sort((a, b) => rank(a) - rank(b));
    const more = document.createElement("button");
    more.className = "more";
    more.title = "Open the tool drawer, showing the tools that work now (T)";
    more.addEventListener("click", () => d.toggleDrawer(true, true));
    const buttons = ordered.map((tool) => {
      const button = document.createElement("button");
      button.append(toolIcon(tool.id, tool.label), tool.label);
      button.title = toolTooltip(tool);
      button.className = tool.id === active ? "active" : "";
      button.addEventListener("click", () => d.armTool(tool));
      return button;
    });
    // Measure pass: lay everything out, read the widths, then keep what fits in two rows. "... More" shows only when some tools do not.
    more.replaceChildren(uiIcon("more"), "... More");
    d.toolbar.replaceChildren(...buttons, ...helpers, more);
    const style = getComputedStyle(d.toolbar);
    const gap = parseFloat(style.columnGap) || 6;
    const chrome = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + 2;
    const width = (b: HTMLElement) => b.getBoundingClientRect().width;
    const count = fitStripCount({ tools: buttons.map(width), helpers: helpers.map(width), more: width(more), gap, chrome }, available);
    for (const b of buttons.slice(count)) b.remove();
    if (count >= ordered.length) more.remove();
  }


  window.addEventListener("resize", () => renderToolbar());
  return { renderToolbar };
}
