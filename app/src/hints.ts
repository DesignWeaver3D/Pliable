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
    items = []; // the sketch tools explain themselves in the status line; no second set of key tips
  } else if (ctx.dragging) {
    items = [
      { keys: "0-9", text: "type an exact value" },
      { keys: "Esc", text: "cancel" },
    ];
  } else if (mods.ctrl) {
    items = [
      { keys: "Ctrl+click", text: "add or remove from the selection" },
      { keys: "/", text: "search commands" },
      { keys: k("history.undo", "Ctrl+Z"), text: "undo" },
    ];
  } else if (mods.shift && ctx.hasSelection) {
    items = [
      { keys: "Shift+click", text: "click an item to add it to the selection" },
      { keys: k("display.isolate", "Shift+H"), text: "isolate the selected body" },
    ];
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

/** Id under which the Getting started card is marked as seen in the dismissed list. */
export const GETTING_STARTED_ID = "getting-started";

/** The six interactions worth knowing first. `keyText` gives the current key for a command id. */
export function gettingStartedItems(keyText: (id: string) => string): HintItem[] {
  const k = (id: string, fallback: string) => keyText(id) || fallback;
  return [
    { keys: "Click", text: "select a face, edge or point (Ctrl+click adds, drag a box selects several)" },
    { keys: "Drag", text: "push or pull a selected face; the arrow on the model changes its size" },
    { keys: "0-9", text: "while dragging, type an exact value and press Enter" },
    { keys: "/", text: "search every tool, setting and command (t: tools, s: settings)" },
    { keys: "T", text: "browse all tools in the drawer on the left" },
    { keys: k("ui.shortcuts", "?"), text: "see and change the keyboard shortcuts" },
  ];
}

/** The card opens by itself once, while hints are on and it has not been closed before. */
export function shouldAutoShowGettingStarted(prefs: HintPrefs): boolean {
  return prefs.on && !prefs.dismissed.includes(GETTING_STARTED_ID);
}

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

/** The tip to show: one already on screen stays until the user closes it (or hints go off); otherwise the one the context asks for. */
export function stickyTip(shown: Tip | null, ctx: HintContext, prefs: HintPrefs): Tip | null {
  if (!prefs.on) return null;
  if (shown && !prefs.dismissed.includes(shown.id)) return ctx.sketch ? null : shown;
  return nextTip(ctx, prefs);
}

export class HintLine {
  readonly prefs = loadPrefs();
  private readonly line = document.createElement("div");
  private readonly tip = document.createElement("div");
  private mods: Modifiers = { ctrl: false, alt: false, shift: false };
  private shown = "";
  private tipShown: Tip | null = null;
  private card: HTMLElement | null = null;
  private readonly host: HTMLElement;

  private readonly context: () => HintContext;
  private readonly keyText: (id: string) => string;

  constructor(host: HTMLElement, context: () => HintContext, keyText: (id: string) => string) {
    this.host = host;
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

  /** Show the Getting started card (opened from the menu or the search, or once on first use). */
  showGettingStarted() {
    this.card?.remove();
    const card = document.createElement("div");
    card.id = "gettingstarted";
    const title = document.createElement("b");
    title.textContent = "Getting started";
    const list = document.createElement("ol");
    for (const item of gettingStartedItems(this.keyText)) {
      const li = document.createElement("li");
      const key = document.createElement("kbd");
      key.textContent = item.keys;
      li.append(key, ` ${item.text}`);
      list.append(li);
    }
    const close = () => {
      if (!this.prefs.dismissed.includes(GETTING_STARTED_ID)) this.prefs.dismissed.push(GETTING_STARTED_ID);
      savePrefs(this.prefs);
      card.remove();
      this.card = null;
    };
    const got = document.createElement("button");
    got.textContent = "Got it";
    got.title = "Close this card; find it again under Menu or by searching for getting started";
    got.onclick = close;
    const off = document.createElement("button");
    off.textContent = "Turn all hints off";
    off.title = "Hide the hint line, tips and this card on start (turn them back on in settings)";
    off.onclick = () => {
      close();
      this.setOn(false);
    };
    const buttons = document.createElement("div");
    buttons.className = "buttons";
    buttons.append(got, off);
    card.append(title, list, buttons);
    this.host.append(card);
    this.card = card;
  }

  /** First run: open the card once if hints are on. */
  autoShowGettingStarted() {
    if (shouldAutoShowGettingStarted(this.prefs)) this.showGettingStarted();
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
    const tip = stickyTip(this.tipShown, ctx, this.prefs);
    if (tip) this.tipShown = tip;
    else if (!this.prefs.on || (this.tipShown && this.prefs.dismissed.includes(this.tipShown.id))) this.tipShown = null;
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
