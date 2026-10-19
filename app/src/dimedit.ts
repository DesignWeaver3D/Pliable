/** Inline editing of a displayed dimension: a numeric field over the dimension text, live preview while typing,
 * Enter applies one undo step, Escape cancels, Tab moves to the next editable dimension. The core decides what an
 * edit means (`dimension_edit`, see `dimedit.py`); an impossible edit comes back as a one-line reason shown in red. */
import type { DimEdit, DimensionOverlay } from "./dimensions";

export interface DimensionEditorHost {
  overlay: DimensionOverlay;
  container: HTMLElement;
  /** Send a `dimension_edit` for the current selection; resolves with the core's reply (a mesh) or rejects with the reason. */
  send(edit: DimEdit, value: number, flip: boolean, commit: boolean): Promise<unknown>;
  /** Show a preview reply from `send`. */
  preview(reply: unknown): void;
  /** Put the committed model back after a cancelled or failed preview. */
  revert(): void;
  /** A commit reply from `send`. */
  committed(reply: unknown, summary: string): void;
}


const HINTS: Record<string, string> = {
  face_distance: "The face you clicked last moves; the other stays. Use the arrows to swap.",
  hole_distance: "The hole you clicked last moves; the other stays. Use the arrows to swap.",
  edge_length: "The face at the far end of the edge moves. Use the arrows to move the near end instead.",
  face_angle: "Draft angle from vertical about the Z pull direction.",
};

const LABELS: Record<string, string> = {
  hole_diameter: "Hole diameter",
  fillet_radius: "Fillet radius",
  edge_length: "Edge length",
  face_distance: "Distance",
  hole_distance: "Hole distance",
  face_angle: "Draft angle",
};

/** The text of a number with up to 4 decimals and no trailing zeros. */
export function formatValue(v: number): string {
  return String(Number(v.toFixed(4)));
}

/** A typed number (a comma counts as the decimal point), or null when the text is not one. */
export function parseValue(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (t === "" || !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  return Number(t);
}

interface Open {
  index: number;
  edit: DimEdit;
  flip: boolean;
  box: HTMLElement;
  input: HTMLInputElement;
  note: HTMLElement;
  timer: number;
  seq: number; // newest request; older replies are dropped
  previewed: boolean;
  busy: boolean;
}

export class DimensionEditor {
  private open: Open | null = null;
  private readonly host: DimensionEditorHost;

  constructor(host: DimensionEditorHost) {
    this.host = host;
    host.overlay.onActivate = (index, at) => this.start(index, at);
    host.overlay.onReset = () => this.close(true);
  }

  get isOpen(): boolean {
    return this.open !== null;
  }

  start(index: number, at: { x: number; y: number }) {
    if (this.open) return;
    const dim = this.host.overlay.dimension(index);
    if (!dim?.edit) return;
    const edit = dim.edit;
    const box = document.createElement("div");
    box.style.cssText = `position:absolute;left:${at.x}px;top:${at.y}px;transform:translate(-50%,-50%);z-index:20;display:flex;flex-direction:column;align-items:center;gap:3px;font:13px system-ui,sans-serif`;
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:3px;align-items:center";
    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = "decimal";
    input.setAttribute("aria-label", LABELS[edit.kind] ?? "Dimension");
    input.style.cssText = "width:78px;padding:2px 5px;font:inherit;color:#ff8a1f;background:#1b1d22;border:1px solid #ff8a1f;border-radius:3px;outline:none;text-align:center";
    input.value = edit.value === null ? dim.text.replace(/^[^\d-]+/, "").replace(/[^\d.]+$/, "") : formatValue(edit.value);
    row.append(input);
    const note = document.createElement("div");
    note.style.cssText = "max-width:260px;padding:1px 6px;border-radius:3px;background:rgba(27,29,34,0.92);font-size:11px;text-align:center;color:#aab";
    const state: Open = { index, edit, flip: false, box, input, note, timer: 0, seq: 0, previewed: false, busy: false };
    if (edit.canFlip) {
      const flip = document.createElement("button");
      flip.type = "button";
      flip.textContent = "⇄";
      flip.title = "Swap which one moves";
      flip.style.cssText = "padding:1px 6px;font:inherit;color:#ff8a1f;background:#1b1d22;border:1px solid #ff8a1f;border-radius:3px;cursor:pointer";
      flip.addEventListener("click", () => {
        state.flip = !state.flip;
        this.schedule(state, 0);
        input.focus();
      });
      row.append(flip);
    }
    box.append(row, note);
    this.open = state;
    this.host.overlay.editing = index;
    this.host.container.append(box);
    this.say(state, edit.blocked ?? HINTS[edit.kind] ?? "", !!edit.blocked);
    // Typing only checks the text; the value is applied on Enter (the swap button still previews at once).
    input.addEventListener("input", () => this.check(state));
    input.addEventListener("keydown", (e) => {
      e.stopPropagation(); // typing here is never a viewport shortcut
      if (e.key === "Enter") {
        e.preventDefault();
        void this.apply(state);
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.close(true);
      } else if (e.key === "Tab") {
        e.preventDefault();
        this.cycle(state, e.shiftKey ? -1 : 1);
      }
    });
    box.addEventListener("focusout", (e) => {
      if (this.open === state && !box.contains(e.relatedTarget as Node | null)) this.close(true);
    });
    // Pointer gestures inside the field are the field's: the viewport would otherwise take focus and close it.
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick"]) box.addEventListener(type, (e) => e.stopPropagation());
    box.addEventListener("mousedown", (e) => {
      if (!(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLButtonElement)) e.preventDefault(); // keep the focus in the field
    });
    input.focus();
    input.select();
  }

  /** Close the field; `revert` puts back the committed model if a preview was showing. */
  close(revert: boolean) {
    const s = this.open;
    if (!s) return;
    this.open = null;
    window.clearTimeout(s.timer);
    s.seq++;
    this.host.overlay.editing = null;
    s.box.remove();
    if (revert && s.previewed) this.host.revert();
  }

  private cycle(from: Open, step: number) {
    const labels = this.host.overlay.editableLabels();
    const at = labels.findIndex((l) => l.index === from.index);
    const next = labels.length > 1 && at >= 0 ? labels[(at + step + labels.length) % labels.length] : null;
    this.close(true);
    if (next) this.start(next.index, next);
  }

  private say(s: Open, text: string, error: boolean) {
    s.note.textContent = text;
    s.note.style.display = text ? "" : "none";
    s.note.style.color = error ? "#ff6b6b" : "#aab";
    s.input.style.borderColor = error ? "#ff4d4d" : "#ff8a1f";
    s.input.style.color = error ? "#ff6b6b" : "#ff8a1f";
    s.input.setAttribute("aria-invalid", error ? "true" : "false");
  }

  private check(s: Open) {
    const blank = s.input.value.trim() === "";
    const ok = blank || parseValue(s.input.value) !== null;
    this.say(s, ok ? (HINTS[s.edit.kind] ?? "") : "Enter a number", !ok);
  }

  private schedule(s: Open, delay: number) {
    window.clearTimeout(s.timer);
    const value = parseValue(s.input.value);
    if (value === null) {
      s.seq++;
      this.say(s, s.input.value.trim() === "" ? (HINTS[s.edit.kind] ?? "") : "Enter a number", s.input.value.trim() !== "");
      return;
    }
    s.timer = window.setTimeout(() => void this.preview(s, value), delay);
  }

  private async preview(s: Open, value: number) {
    const seq = ++s.seq;
    try {
      const reply = await this.host.send(s.edit, value, s.flip, false);
      if (this.open !== s || seq !== s.seq) return;
      s.previewed = true;
      this.host.preview(reply);
      this.say(s, HINTS[s.edit.kind] ?? "", false);
    } catch (e) {
      if (this.open !== s || seq !== s.seq) return;
      this.say(s, (e as Error).message, true);
      if (s.previewed) {
        s.previewed = false;
        this.host.revert();
      }
    }
  }

  private async apply(s: Open) {
    const value = parseValue(s.input.value);
    if (value === null) {
      this.say(s, "Enter a number", true);
      return;
    }
    if (s.busy) return;
    s.busy = true;
    window.clearTimeout(s.timer);
    const seq = ++s.seq;
    try {
      const reply = await this.host.send(s.edit, value, s.flip, true);
      if (this.open !== s || seq !== s.seq) return;
      this.close(false);
      this.host.committed(reply, `${LABELS[s.edit.kind] ?? "Dimension"} set to ${formatValue(value)}`);
    } catch (e) {
      if (this.open !== s) return;
      this.say(s, (e as Error).message, true); // nothing changed; the field stays open
      if (s.previewed) {
        s.previewed = false;
        this.host.revert();
      }
    } finally {
      s.busy = false;
    }
  }
}
