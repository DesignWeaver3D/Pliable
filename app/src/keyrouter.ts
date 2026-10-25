/** Wires the shortcut policy (keys.ts) to the page: one keydown entry point, viewport engagement with a focus ring,
 *  cancel on window blur, saved keymap and the Keys settings dialog. */
import { Engagement, Keymap, chordOfEvent, decideKey, formatChord, validateBinding, type KeyContext } from "./keys";
import { shortcutSheetHtml } from "./shortcutsheet";

const STORAGE_KEY = "pliable.keymap";

export interface KeyHost {
  /** The element that shows the 3D view; bare keys are live while the pointer is over it or after a click in it. */
  viewport: HTMLElement;
  /** What each command id does. Ids without a handler are ignored. */
  handlers: Record<string, (e: KeyboardEvent) => void>;
  /** A drag or typed value entry is live. */
  entryActive: () => boolean;
  sketchActive: () => boolean;
  /** The window lost focus: cancel any live drag and typed entry. */
  cancelInteraction: () => void;
  status: HTMLElement;
  /** The hint line and tips switch, shown in the shortcuts window. */
  hints?: { get: () => boolean; set: (on: boolean) => void };
}

function load(): Keymap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return Keymap.fromJson(raw ? JSON.parse(raw) : null);
  } catch {
    return new Keymap();
  }
}

function save(keymap: Keymap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keymap.data));
  } catch {
    // storage blocked: the changes last for this session only
  }
}

const isTextField = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']");

export class KeyRouter {
  readonly keymap = load();
  readonly engagement = new Engagement();
  private suspended = false; // a dialog that captures keys is open
  private hinted = false;
  private ringTimer = 0;

  constructor(private readonly host: KeyHost) {
    const view = host.viewport;
    view.addEventListener("pointerenter", () => this.engage(() => this.engagement.pointerEnter()));
    view.addEventListener("pointermove", () => { if (!this.engagement.active(performance.now())) this.engage(() => this.engagement.pointerEnter()); });
    view.addEventListener("pointerleave", () => this.engage(() => this.engagement.pointerLeave(performance.now())));
    view.addEventListener("pointerdown", () => this.engage(() => this.engagement.click()));
    // Clicking anything outside the viewport (a panel, a field) hands the keyboard to that control.
    document.addEventListener("pointerdown", (e) => {
      if (!view.contains(e.target as Node)) this.engage(() => this.engagement.release());
    }, true);
    document.addEventListener("focusin", (e) => {
      if (isTextField(e.target)) this.engage(() => this.engagement.release());
    });
    const lost = () => {
      this.engage(() => this.engagement.blur());
      host.cancelInteraction();
      this.hinted = false;
    };
    window.addEventListener("blur", lost);
    document.addEventListener("visibilitychange", () => { if (document.hidden) lost(); });
    window.addEventListener("keydown", (e) => this.onKeyDown(e));
    this.refreshRing();
  }

  private engage(change: () => void) {
    change();
    this.refreshRing();
  }

  /** The focus ring shows exactly when bare keys are live. */
  private refreshRing() {
    clearTimeout(this.ringTimer);
    const now = performance.now();
    this.host.viewport.classList.toggle("engaged", this.engagement.active(now) && this.keymap.data.singleKeys);
    const wait = this.engagement.nextChange(now);
    if (wait !== null) this.ringTimer = window.setTimeout(() => this.refreshRing(), wait + 5);
  }

  private context(e: KeyboardEvent): KeyContext {
    return {
      pageFocused: document.hasFocus(),
      inTextField: isTextField(e.target),
      entryActive: this.host.entryActive(),
      engaged: this.engagement.active(performance.now()),
      sketchActive: this.host.sketchActive(),
    };
  }

  private onKeyDown(e: KeyboardEvent) {
    if (this.suspended) return;
    const decision = decideKey(e, this.context(e), this.keymap);
    if (decision.run === null) {
      if (decision.reason === "disengaged" && !this.hinted) {
        this.hinted = true;
        this.host.status.textContent = "Single-key shortcuts work while the pointer is over the 3D view. Click the view to use them.";
      }
      return;
    }
    const handler = this.host.handlers[decision.run.id];
    if (!handler) return;
    e.preventDefault();
    handler(e);
  }

  // ---- Settings dialog ------------------------------------------------------------------------------------------

  openSettings() {
    if (document.getElementById("keys-dialog")) return;
    this.suspended = true;
    const box = document.createElement("div");
    box.id = "keys-dialog";
    box.style.cssText = "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);z-index:100";
    const card = document.createElement("div");
    card.style.cssText = "background:#2b2b2b;color:#eee;padding:16px 20px;border-radius:8px;width:min(560px,94vw);max-height:84vh;overflow:auto;font:14px sans-serif";
    const close = () => {
      document.removeEventListener("keydown", capture, true);
      box.remove();
      this.suspended = false;
    };
    let capturing: string | null = null;
    let message = "";
    const rules = document.createElement("p");
    rules.style.cssText = "font-size:12px;color:#aaa;margin:4px 0 8px";
    rules.textContent = "One key with optional Ctrl, Alt or Shift per shortcut; no sequences. A key that changes the model or a setting at once needs Ctrl or Alt. Single keys work only while the pointer is over the 3D view.";

    const capture = (e: KeyboardEvent) => {
      if (capturing === null) {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
        return;
      }
      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return; // wait for the main key
      e.preventDefault();
      e.stopPropagation();
      const id = capturing;
      if (e.key === "Escape") { capturing = null; message = ""; render(); return; }
      const chord = chordOfEvent(e);
      const text = formatChord(chord);
      const command = this.keymap.list().find((c) => c.id === id)!;
      const result = validateBinding(command, text, this.keymap.all());
      if (result.ok) {
        this.keymap.assign(id, [text]);
        save(this.keymap);
        message = `${command.label}: ${text}`;
      } else message = result.reason;
      capturing = null;
      render();
    };
    document.addEventListener("keydown", capture, true);

    const render = () => {
      const title = document.createElement("h3");
      title.textContent = "Keyboard shortcuts";
      title.style.margin = "0 0 4px";
      const single = document.createElement("label");
      const toggle = document.createElement("input");
      toggle.type = "checkbox";
      toggle.checked = this.keymap.data.singleKeys;
      toggle.title = "Turn keys that need no Ctrl or Alt on or off; shortcuts with Ctrl or Alt always work";
      toggle.onchange = () => {
        this.keymap.data = { ...this.keymap.data, singleKeys: toggle.checked };
        save(this.keymap);
        this.refreshRing();
      };
      single.append(toggle, " Enable single-key shortcuts (keys without Ctrl or Alt)");
      const hintsRow = document.createElement("label");
      hintsRow.style.cssText = "display:block;margin-top:4px";
      if (this.host.hints) {
        const hintBox = document.createElement("input");
        hintBox.type = "checkbox";
        hintBox.checked = this.host.hints.get();
        hintBox.title = "Show the line of available keys at the bottom of the view and the first-use tips";
        hintBox.onchange = () => this.host.hints!.set(hintBox.checked);
        hintsRow.append(hintBox, " Show hints (the key line at the bottom of the view and first-use tips)");
      }
      const note = document.createElement("div");
      note.style.cssText = "min-height:1.4em;color:#ffb878;margin:6px 0";
      note.textContent = capturing ? "Press the new key (Escape to cancel)..." : message;
      const table = document.createElement("div");
      for (const c of this.keymap.list()) {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;gap:8px;align-items:center;padding:2px 0";
        const label = document.createElement("span");
        label.style.flex = "1";
        label.textContent = c.label;
        const keyText = document.createElement("code");
        keyText.style.cssText = "min-width:90px;text-align:right";
        keyText.textContent = this.keymap.hint(c.id) || "none";
        const change = document.createElement("button");
        change.textContent = capturing === c.id ? "Press a key..." : "Change";
        change.onclick = () => { capturing = c.id; message = ""; render(); };
        change.title = `Choose a new key for: ${c.label}`;
        change.hidden = !!c.fixed;
        const reset = document.createElement("button");
        reset.textContent = "Reset";
        reset.disabled = !(c.id in this.keymap.data.bindings);
        reset.title = "Go back to the default key for this command";
        reset.hidden = !!c.fixed;
        reset.onclick = () => { this.keymap.reset(c.id); save(this.keymap); message = ""; render(); };
        row.append(label, keyText, change, reset);
        table.append(row);
      }
      const buttons = document.createElement("div");
      buttons.style.cssText = "display:flex;gap:8px;justify-content:flex-end;margin-top:10px";
      const all = document.createElement("button");
      all.textContent = "Restore defaults";
      all.title = "Put every shortcut back to its default key";
      all.onclick = () => { this.keymap.resetAll(); this.keymap.data = { ...this.keymap.data, singleKeys: true }; save(this.keymap); message = ""; this.refreshRing(); render(); };
      const print = document.createElement("button");
      print.textContent = "Print";
      print.title = "Open a printable page of the shortcuts as they are set now";
      print.onclick = () => {
        const sheet = window.open("", "_blank");
        if (!sheet) {
          message = "The browser blocked the print page; allow pop-ups for this site";
          render();
          return;
        }
        sheet.document.write(shortcutSheetHtml(this.keymap.list().map((c) => ({ label: c.label, keys: this.keymap.hint(c.id) }))));
        sheet.document.close();
        sheet.focus();
        sheet.print();
      };
      const done = document.createElement("button");
      done.textContent = "Close";
      done.title = "Close the shortcut list";
      done.onclick = close;
      buttons.append(all, print, done);
      card.replaceChildren(title, rules, single, hintsRow, note, table, buttons);
    };
    render();
    box.append(card);
    document.body.append(box);
  }

  /** Adds the Keys button to the top bar. */
  installButton(bar: HTMLElement) {
    const button = document.createElement("button");
    button.textContent = "Keys";
    button.title = "Keyboard shortcuts: see and change them";
    button.onclick = () => this.openSettings();
    bar.append(button);
  }
}
