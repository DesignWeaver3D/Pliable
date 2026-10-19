// Command search: a permanent field in the top bar (Ctrl+K or / focuses it) with a results list under it. Type to filter, arrows to move, Enter to run, Escape to close.

import { loadRecents, pushRecent, saveRecents, searchItems, SCOPES, parseQuery, type Scope } from "./search";

export interface Command {
  label: string;
  /** Tooltip for the row (what the command does). */
  title?: string;
  /** Extra text shown on the right (e.g. what selection a tool needs). */
  hint?: string;
  /** Which prefix group the command belongs to (t: s: b: v: f:). */
  scope?: Scope;
  /** Extra search words (other names for the command). */
  keywords?: string[];
  /** Disabled commands are listed but cannot run. */
  enabled: boolean;
  run: () => void;
}

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

export class Palette {
  private root = document.getElementById("palette")!;
  private input = document.getElementById("palette-input") as HTMLInputElement;
  private list = document.getElementById("palette-list")!;
  private shown: Command[] = [];
  private active = 0;
  private recents = loadRecents();

  constructor(private getCommands: () => Command[]) {
    this.input.addEventListener("input", () => this.render());
    this.input.addEventListener("focus", () => this.open(false));
    document.addEventListener("pointerdown", (e) => {
      if (this.isOpen && e.target !== this.input && !this.root.contains(e.target as Node)) this.close();
    });
    this.input.addEventListener("keydown", (e) => this.onKey(e));
    this.root.addEventListener("pointerdown", (e) => {
      if (e.target === this.root) this.close();
    });
    window.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        this.isOpen ? this.close() : this.open();
      } else if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target)) {
        e.preventDefault();
        this.open();
      }
    });
  }

  get isOpen() {
    return !this.root.hidden;
  }

  open(focus = true) {
    if (this.isOpen && !focus) return;
    const box = this.input.getBoundingClientRect();
    // The search field sits at the right end of the bar, so keep the 520 px result box on screen.
    this.root.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - Math.min(520, window.innerWidth * 0.92) - 8))}px`;
    this.root.hidden = false;
    if (focus) this.input.value = "";
    this.active = 0;
    this.render();
    if (focus) this.input.focus();
  }

  close() {
    this.root.hidden = true;
    this.input.blur();
  }

  private render() {
    const raw = this.input.value;
    const { scope, text } = parseQuery(raw);
    const found = searchItems(this.getCommands(), raw, this.recents);
    // Usable commands first, keeping the ranking inside each group.
    this.shown = [...found.filter((c) => c.enabled), ...found.filter((c) => !c.enabled)];
    this.active = Math.min(this.active, Math.max(this.shown.length - 1, 0));
    const children: HTMLElement[] = [];
    if (!raw.trim()) {
      const help = document.createElement("div");
      help.className = "scopes";
      help.append("Type to search, or start with ");
      for (const s of SCOPES) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.textContent = `${s.prefix}:`;
        chip.title = `Only ${s.name}`;
        chip.onpointerdown = (e) => e.preventDefault(); // keep the field focused
        chip.onclick = () => {
          this.input.value = `${s.prefix}:`;
          this.active = 0;
          this.render();
          this.input.focus();
        };
        help.append(chip, ` ${s.name}  `);
      }
      children.push(help);
    } else if (scope && !text) {
      const name = SCOPES.find((s) => s.scope === scope)!.name;
      const head = document.createElement("div");
      head.className = "scopes";
      head.textContent = `Showing ${name} only`;
      children.push(head);
    }
    const recentCount = !raw.trim() ? this.shown.filter((c) => this.recents.includes(c.label)).length : 0;
    this.shown.forEach((command, i) => {
      if (recentCount && i === 0) children.push(Object.assign(document.createElement("div"), { className: "group", textContent: "Recent" }));
      if (recentCount && i === recentCount) children.push(Object.assign(document.createElement("div"), { className: "group", textContent: "All commands" }));
      const row = document.createElement("div");
      row.className = "row" + (i === this.active ? " active" : "") + (command.enabled ? "" : " disabled");
      const label = document.createElement("span");
      label.textContent = command.label;
      if (command.title) row.title = command.title;
      const hint = document.createElement("span");
      hint.className = "hint";
      hint.textContent = command.hint ?? "";
      row.append(label, hint);
      row.addEventListener("click", () => this.run(command));
      children.push(row);
    });
    if (this.shown.length === 0) {
      const empty = document.createElement("div");
      empty.className = "row disabled empty";
      empty.textContent = raw.trim() ? `Nothing matches "${raw.trim()}". Try another word, or clear the field to see recent commands.` : "No commands";
      children.push(empty);
    }
    this.list.replaceChildren(...children);
    this.list.querySelector(".row.active")?.scrollIntoView({ block: "nearest" });
  }

  private run(command: Command) {
    if (!command.enabled) return;
    this.recents = pushRecent(this.recents, command.label);
    saveRecents(this.recents);
    this.input.value = "";
    this.close();
    command.run();
  }

  private onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      this.close();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      this.active = (this.active + step + this.shown.length) % Math.max(this.shown.length, 1);
      this.render();
    } else if (e.key === "Enter") {
      const command = this.shown[this.active];
      if (command) this.run(command);
    }
  }
}
