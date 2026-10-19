/** Discoverability of hidden modes: one hint line at the bottom of the view with the keys valid right now,
 *  dismissible first-use tips, and one switch that turns all hints off. The logic is plain so it can be tested. */

export interface HintContext {
  /** A tool drag or typed value entry is live. */
  dragging: boolean;
  sketch: boolean;
  hasSelection: boolean;
}

export interface Modifiers {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

export interface HintItem {
  keys: string;
  text: string;
}

/** The most items the hint line shows at once. */
export const MAX_HINTS = 5;

/** The keys to show now, given what the user is doing and which modifiers are held. `keyText` gives the current key for a command id. */
export function hintItems(ctx: HintContext, mods: Modifiers, keyText: (id: string) => string): HintItem[] {
  const k = (id: string, fallback: string) => keyText(id) || fallback;
  let items: HintItem[];
  if (ctx.sketch) {
    items = [
      { keys: "Enter", text: "finish the line chain" },
      { keys: "Esc", text: "cancel the step, then leave" },
      { keys: k("sketch.undo", "Ctrl+Z"), text: "undo" },
      { keys: "Delete", text: "delete the selection" },
    ];
  } else if (ctx.dragging) {
    items = [
      { keys: k("measure", "M"), text: "measure pick (while dragging)" },
      { keys: "0-9", text: "type an exact value" },
      { keys: "Esc", text: "cancel" },
    ];
  } else if (mods.ctrl) {
    items = [
      { keys: "Ctrl+click", text: "add or remove from the selection" },
      { keys: "Ctrl+K", text: "search commands" },
      { keys: k("history.undo", "Ctrl+Z"), text: "undo" },
    ];
  } else if (mods.shift && ctx.hasSelection) {
    items = [{ keys: k("display.isolate", "Shift+H"), text: "isolate the selected body" }];
  } else if (mods.alt) {
    items = [{ keys: k("display.showAll", "Alt+H"), text: "show all bodies" }];
  } else {
    items = []; // idle: no static legend; the search box shows its own shortcut and the Keys dialog lists the rest
  }
  return items.slice(0, MAX_HINTS);
}

export interface Tip {
  id: string;
  text: string;
}

export const TIPS: Tip[] = [
  { id: "measure", text: "Tip: press M while dragging a tool to measure distances to other geometry (pick mode)." },
  { id: "seethrough", text: "Tip: press X to see through the model and pick edges and faces behind it." },
];

export interface HintPrefs {
  /** Master switch: false hides the hint line and all tips. */
  on: boolean;
  /** Tips the user has dismissed. */
  dismissed: string[];
}

const KEY = "pliable.hints";

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadPrefs(storage: Pick<Storage, "getItem"> | null = safeStorage()): HintPrefs {
  const prefs: HintPrefs = { on: true, dismissed: [] };
  try {
    const raw = JSON.parse(storage?.getItem(KEY) ?? "{}");
    if (raw.on === false) prefs.on = false;
    if (Array.isArray(raw.dismissed)) prefs.dismissed = raw.dismissed.filter((t: unknown): t is string => typeof t === "string");
  } catch {
    /* defaults */
  }
  return prefs;
}

export function savePrefs(prefs: HintPrefs, storage: Pick<Storage, "setItem"> | null = safeStorage()) {
  try {
    storage?.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* storage can be blocked */
  }
}

/** Which tip to offer now: the measure tip during a drag, the see-through tip at a selection. */
export function nextTip(ctx: HintContext, prefs: HintPrefs): Tip | null {
  if (!prefs.on || ctx.sketch) return null;
  const want = ctx.dragging ? "measure" : ctx.hasSelection ? "seethrough" : null;
  const tip = TIPS.find((t) => t.id === want);
  return tip && !prefs.dismissed.includes(tip.id) ? tip : null;
}

export class HintLine {
  readonly prefs = loadPrefs();
  private readonly line = document.createElement("div");
  private readonly tip = document.createElement("div");
  private mods: Modifiers = { ctrl: false, alt: false, shift: false };
  private shown = "";

  private readonly context: () => HintContext;
  private readonly keyText: (id: string) => string;

  constructor(host: HTMLElement, context: () => HintContext, keyText: (id: string) => string) {
    this.context = context;
    this.keyText = keyText;
    this.line.id = "hintline";
    this.line.title = "Keys that work right now. Turn hints off in the keyboard shortcuts window.";
    this.tip.id = "hinttip";
    this.tip.hidden = true;
    host.append(this.line, this.tip);
    const mod = (e: KeyboardEvent) => {
      this.mods = { ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, shift: e.shiftKey };
      this.refresh();
    };
    window.addEventListener("keydown", mod);
    window.addEventListener("keyup", mod);
    window.addEventListener("blur", () => {
      this.mods = { ctrl: false, alt: false, shift: false };
      this.refresh();
    });
    window.setInterval(() => this.refresh(), 250); // the context lives in other modules; a cheap poll keeps this one independent
    this.refresh();
  }

  setOn(on: boolean) {
    this.prefs.on = on;
    savePrefs(this.prefs);
    this.shown = "";
    this.refresh();
  }

  refresh() {
    const ctx = this.context();
    const items = this.prefs.on ? hintItems(ctx, this.mods, this.keyText) : [];
    const tip = nextTip(ctx, this.prefs);
    const sig = JSON.stringify([items, tip?.id]);
    if (sig === this.shown) return;
    this.shown = sig;
    this.line.hidden = items.length === 0;
    this.line.replaceChildren(
      ...items.map((item) => {
        const span = document.createElement("span");
        const key = document.createElement("kbd");
        key.textContent = item.keys;
        span.append(key, ` ${item.text}`);
        return span;
      }),
    );
    this.tip.hidden = !tip;
    if (tip) {
      const text = document.createElement("span");
      text.textContent = tip.text;
      const got = document.createElement("button");
      got.textContent = "Got it";
      got.title = "Do not show this tip again";
      got.onclick = () => {
        this.prefs.dismissed.push(tip.id);
        savePrefs(this.prefs);
        this.shown = "";
        this.refresh();
      };
      const off = document.createElement("button");
      off.textContent = "Turn all hints off";
      off.title = "Hide the hint line and every tip (turn them back on in the keyboard shortcuts window)";
      off.onclick = () => this.setOn(false);
      this.tip.replaceChildren(text, got, off);
    }
  }
}
