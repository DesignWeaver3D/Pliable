// The body list: a plain list of the model's bodies, always shown on the left of the 3D view. Each row has the body's name, an eye (hide / show)
// and an isolate toggle; a right-click opens a small menu (Rename, and room for later actions). Clicking selects.

import { clickRows, isIsolated } from "./bodylogic";
import { uiIcon } from "./icons";
import { bodyColor } from "./bodycolors";
import { onSettingsChange, settings } from "./settings";

export interface BodyInfo {
  id: number;
  name: string;
  solid: number;
  bounds: number[];
  /** True while the body is still the primitive that made it; `why` says what ended that. */
  editable?: boolean;
  why?: string | null;
  recipe?: { tool: string; params: Record<string, number>; rotated: boolean };
}

export interface BodyListHost {
  toggleHide(id: number): void;
  toggleIsolate(id: number): void;
  toggleGhost(id: number): void;
  toggleFocus(id: number): void;
  rename(id: number, name: string): void;
  /** The rows the user selected (empty when cleared). */
  select(ids: number[]): void;
  hover(id: number | null): void;
  /** Reopen the creation form of an editable primitive. */
  edit(id: number): void;
}

export class BodyList {
  private bodies: BodyInfo[] = [];
  private hidden: ReadonlySet<number> = new Set();
  private ghost: ReadonlySet<number> = new Set();
  private focus: number | null = null;
  private selected: number[] = [];
  private hovered: number | null = null;
  private anchor: number | null = null;
  private menu: HTMLElement | null = null;

  constructor(private readonly list: HTMLElement, private readonly host: BodyListHost, private readonly count: HTMLElement) {
    list.addEventListener("pointerleave", () => host.hover(null));
    onSettingsChange(() => this.render());
    document.addEventListener(
      "pointerdown",
      (e) => {
        if (this.menu && !this.menu.contains(e.target as Node)) this.closeMenu();
      },
      true,
    );
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.closeMenu();
    });
  }

  get order(): number[] {
    return this.bodies.map((b) => b.id);
  }

  setBodies(bodies: BodyInfo[], hidden: ReadonlySet<number>, ghost: ReadonlySet<number> = new Set(), focus: number | null = null) {
    this.bodies = bodies;
    this.hidden = hidden;
    this.ghost = ghost;
    this.focus = focus;
    this.selected = this.selected.filter((id) => bodies.some((b) => b.id === id));
    this.render();
  }

  setSelected(ids: number[]) {
    this.selected = ids;
    if (ids.length === 1) this.anchor = ids[0];
    this.paint();
  }

  setHovered(id: number | null) {
    this.hovered = id;
    this.paint();
  }

  private render() {
    this.closeMenu();
    this.count.textContent = String(this.bodies.length);
    if (this.bodies.length === 0) {
      const empty = document.createElement("div");
      empty.className = "nobodies";
      empty.textContent = "No bodies";
      this.list.replaceChildren(empty);
    } else {
      this.list.replaceChildren(...this.bodies.map((body) => this.row(body)));
    }
    this.paint();
  }

  private paint() {
    for (const el of this.list.children) {
      const id = Number((el as HTMLElement).dataset.id);
      el.classList.toggle("selected", this.selected.includes(id));
      el.classList.toggle("hovered", this.hovered === id);
    }
  }

  private row(body: BodyInfo): HTMLElement {
    const all = this.order;
    const hidden = this.hidden.has(body.id);
    const isolated = isIsolated(this.hidden, all, body.id);
    const row = document.createElement("div");
    row.className = "bodyrow" + (hidden ? " dim" : "");
    row.dataset.id = String(body.id);
    row.title = body.name;
    const name = document.createElement("span");
    name.className = "bodyname";
    name.textContent = body.name;
    const dot = document.createElement("span");
    dot.className = "bodydot";
    const tinted = settings.randomBodyColors && !hidden;
    if (tinted) {
      name.style.color = bodyColor(body.id);
      dot.style.background = bodyColor(body.id);
    }
    const eye = this.toggle(hidden ? "eyeOff" : "eye", hidden ? "Show this body" : "Hide this body", () => this.host.toggleHide(body.id), false);
    const iso = this.toggle("isolate", isolated ? "Show all bodies again" : "Show only this body", () => this.host.toggleIsolate(body.id), isolated);
    const seeThrough = this.ghost.has(body.id);
    const xray = this.toggle(
      "xray",
      seeThrough ? "Make this body solid again" : "See-through: draw this body transparent so you can see and snap to what is behind it",
      () => this.host.toggleGhost(body.id),
      seeThrough,
    );
    const focused = this.focus === body.id;
    const focus = this.toggle(
      "focus",
      focused
        ? "Stop focusing: make the other bodies solid again"
        : "Focus on this body: make all other bodies see-through so you can still snap to their edges and faces; click again to restore",
      () => this.host.toggleFocus(body.id),
      focused,
    );
    if (tinted) row.append(dot);
    row.append(name, eye, iso, xray, focus);
    row.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("button, input")) return;
      const result = clickRows(all, this.selected, this.anchor, body.id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
      this.anchor = result.anchor;
      this.selected = result.ids;
      this.paint();
      this.host.select(result.ids);
    });
    row.addEventListener("pointerenter", () => this.host.hover(body.id));
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.openMenu(body, e.clientX, e.clientY);
    });
    return row;
  }

  private toggle(icon: string, title: string, run: () => void, on: boolean): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "bodybtn" + (on ? " on" : "");
    button.title = title;
    button.setAttribute("aria-label", title);
    button.setAttribute("aria-pressed", String(on));
    button.append(uiIcon(icon, 15));
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      run();
    });
    return button;
  }

  closeMenu() {
    this.menu?.remove();
    this.menu = null;
  }

  private openMenu(body: BodyInfo, x: number, y: number) {
    this.closeMenu();
    const menu = document.createElement("div");
    menu.className = "bodymenu";
    menu.setAttribute("role", "menu");
    const item = (label: string, run: (() => void) | null, title = "") => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.textContent = label;
      button.disabled = run === null;
      if (title) button.title = title;
      if (run) {
        button.addEventListener("click", () => {
          this.closeMenu();
          run();
        });
      }
      menu.append(button);
    };
    item("Rename", () => this.startRename(body));
    item(
      "Edit primitive",
      body.editable ? () => this.host.edit(body.id) : null,
      body.editable ? "Reopen the form and handles this body was made with" : (body.why ?? "This body is not a primitive"),
    );
    item("Duplicate", null); // later actions: the places are here so the menu does not move when they arrive
    item("Delete", null);
    menu.style.left = `${Math.min(x, window.innerWidth - 150)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - 140)}px`;
    document.body.append(menu);
    this.menu = menu;
  }

  /** Inline rename: Enter commits, Escape (or leaving the field) cancels. */
  startRename(body: BodyInfo) {
    const row = [...this.list.children].find((el) => Number((el as HTMLElement).dataset.id) === body.id) as HTMLElement | undefined;
    const name = row?.querySelector(".bodyname") as HTMLElement | null;
    if (!row || !name) return;
    const input = document.createElement("input");
    input.className = "bodyedit";
    input.value = body.name;
    input.maxLength = 80;
    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      const value = input.value.trim();
      if (commit && value && value !== body.name) this.host.rename(body.id, value);
      else input.replaceWith(name);
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation(); // typing a name must not trigger tool shortcuts
      if (e.key === "Enter") finish(true);
      else if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(false));
    name.replaceWith(input);
    input.focus();
    input.select();
  }
}
