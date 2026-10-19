// Command search: a permanent field in the top bar (Ctrl+K or / focuses it) with a results list under it. Type to filter, arrows to move, Enter to run, Escape to close.

export interface Command {
  label: string;
  /** Tooltip for the row (what the command does). */
  title?: string;
  /** Extra text shown on the right (e.g. what selection a tool needs). */
  hint?: string;
  /** Disabled commands are listed but cannot run. */
  enabled: boolean;
  run: () => void;
}

/** Subsequence match, so "fc" finds "Fillet/Chamfer". */
function matches(label: string, query: string): boolean {
  const text = label.toLowerCase();
  let at = 0;
  for (const ch of query.toLowerCase()) {
    at = text.indexOf(ch, at);
    if (at < 0) return false;
    at++;
  }
  return true;
}

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

export class Palette {
  private root = document.getElementById("palette")!;
  private input = document.getElementById("palette-input") as HTMLInputElement;
  private list = document.getElementById("palette-list")!;
  private shown: Command[] = [];
  private active = 0;

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
    const query = this.input.value.trim();
    this.shown = this.getCommands()
      .filter((c) => matches(c.label, query))
      .sort((a, b) => Number(b.enabled) - Number(a.enabled)); // stable: usable commands first
    this.active = Math.min(this.active, Math.max(this.shown.length - 1, 0));
    this.list.replaceChildren(
      ...this.shown.map((command, i) => {
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
        return row;
      }),
    );
    if (this.shown.length === 0) {
      const empty = document.createElement("div");
      empty.className = "row disabled";
      empty.textContent = "No matching commands";
      this.list.replaceChildren(empty);
    }
  }

  private run(command: Command) {
    if (!command.enabled) return;
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
