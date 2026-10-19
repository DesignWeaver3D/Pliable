/** Keyboard shortcut policy as plain logic (no DOM), so it can be tested with `node --test app/tests`.
 *
 *  Rules (docs/research/shortcut-policy.md, reconciled with the owner rule of 2026-10-18):
 *  - A shortcut is one key plus optional modifiers. No sequences, chords with a leader key or timed combos.
 *  - A bare key (no Ctrl/Alt/Meta) may arm a tool, change the view or the selection display. A command that
 *    changes the model or an application setting immediately needs Ctrl or Alt (or a confirmation, or the search).
 *  - Bare keys act only while the viewport is engaged (pointer over it, or clicked), the page has focus, the
 *    key is a fresh press, and no text field or value entry owns the keyboard.
 *  - Every shortcut can be redefined by the user, under the same rules.
 */

export type KeyClass =
  | "view" // camera or projection
  | "display" // what is drawn (hide, isolate); reversible, never touches the model
  | "arm" // arms a tool; nothing changes until the user commits
  | "history" // undo and redo
  | "model" // changes the model the moment it fires
  | "setting"; // changes an application setting the moment it fires

export interface KeyCommand {
  id: string;
  label: string;
  class: KeyClass;
  /** Default chords, e.g. ["Digit0", "Numpad0"] or ["Ctrl+Z"]. */
  defaults: string[];
  /** Held keys may fire the command again. */
  repeat?: boolean;
  /** Not available while a sketch is being edited (the sketch has its own undo and delete). */
  notInSketch?: boolean;
  /** Only while a sketch is being edited. */
  onlyInSketch?: boolean;
  /** Fixed meaning that cannot be reassigned (cancel, confirm, delete). */
  fixed?: boolean;
  /** Works even when the viewport is not engaged: cancelling is never harmful. */
  anyFocus?: boolean;
  /** Also runs while a tool drag is live (the command is about the drag itself). */
  duringDrag?: boolean;
}

/** Whether two commands can be active at the same time (so they may not share a key). */
const overlap = (a: KeyCommand, b: KeyCommand) => !((a.onlyInSketch && b.notInSketch) || (b.onlyInSketch && a.notInSketch));

export const KEY_COMMANDS: KeyCommand[] = [
  ...(["iso", "front", "top", "right", "rear", "bottom", "left"] as const).map((name, n) => ({
    id: `view.${name}`,
    label: `View: ${name === "iso" ? "isometric" : name}`,
    class: "view" as const,
    defaults: [`Digit${n}`, `Numpad${n}`],
  })),
  { id: "view.projection", label: "Toggle perspective / orthographic", class: "view", defaults: ["P"] },
  { id: "view.lookAtFace", label: "Look at selected face", class: "view", defaults: ["V"] },
  { id: "display.seeThrough", label: "Toggle see-through selection", class: "display", defaults: ["X"] },
  { id: "display.drawer", label: "Show or hide the tool drawer", class: "display", defaults: ["T"], notInSketch: true },
  { id: "measure", label: "Measure to other geometry while dragging a tool", class: "display", defaults: ["M"], duringDrag: true, notInSketch: true },
  { id: "display.hide", label: "Hide body", class: "display", defaults: ["H"], notInSketch: true },
  { id: "display.isolate", label: "Isolate body", class: "display", defaults: ["Shift+H"], notInSketch: true },
  { id: "display.showAll", label: "Show all bodies", class: "display", defaults: ["Alt+H"], notInSketch: true },
  { id: "history.undo", label: "Undo", class: "history", defaults: ["Ctrl+Z"], repeat: true, notInSketch: true },
  { id: "history.redo", label: "Redo", class: "history", defaults: ["Ctrl+Y", "Ctrl+Shift+Z"], repeat: true, notInSketch: true },
  // Sketch editing keys: fixed, but they pass through the same guards as every other shortcut.
  { id: "sketch.undo", label: "Sketch: undo", class: "history", defaults: ["Ctrl+Z"], onlyInSketch: true, fixed: true },
  { id: "sketch.cancel", label: "Sketch: cancel the step, then leave", class: "view", defaults: ["Escape"], onlyInSketch: true, fixed: true, anyFocus: true },
  { id: "sketch.finish", label: "Sketch: finish the line chain", class: "view", defaults: ["Enter"], onlyInSketch: true, fixed: true },
  { id: "sketch.delete", label: "Sketch: delete selection (Ctrl+Z restores)", class: "history", defaults: ["Delete", "Backspace"], onlyInSketch: true, fixed: true },
];

// ---- Chords --------------------------------------------------------------------------------------------------

export interface Chord {
  ctrl: boolean; // Ctrl or Meta
  alt: boolean;
  shift: boolean;
  /** `event.code` for physical keys (Digit0, Numpad0, F2, ArrowUp), else the lower-case printed key. */
  main: string;
}

const MODIFIER_NAMES = new Set(["ctrl", "control", "cmd", "meta", "alt", "option", "shift"]);
const CODE_LIKE = /^(Digit\d|Numpad\w+|F\d{1,2}|Arrow\w+|Page(Up|Down)|Home|End|Insert|Delete|Backspace|Tab|Enter|Escape|Space)$/;

/** Parse "Ctrl+Shift+Z" or "Digit0". Returns null for anything that is not exactly one key plus modifiers. */
export function parseChord(text: string): Chord | null {
  const parts = text.trim().split("+");
  const chord: Chord = { ctrl: false, alt: false, shift: false, main: "" };
  // "Ctrl++" style (the plus key itself) is not supported: a literal plus is entered as "Equal" with Shift.
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    if (!part) return null;
    const lower = part.toLowerCase();
    if (i < parts.length - 1) {
      if (!MODIFIER_NAMES.has(lower)) return null;
      if (lower === "ctrl" || lower === "control" || lower === "cmd" || lower === "meta") chord.ctrl = true;
      else if (lower === "alt" || lower === "option") chord.alt = true;
      else chord.shift = true;
    } else {
      if (MODIFIER_NAMES.has(lower)) return null; // a modifier alone is not a shortcut
      if (/\s/.test(part)) return null;
      chord.main = CODE_LIKE.test(part) ? part : part.length === 1 ? lower : /^Key[A-Z]$/.test(part) ? part[3].toLowerCase() : "";
      if (!chord.main) return null;
    }
  }
  return chord;
}

export function formatChord(c: Chord): string {
  const main = c.main.length === 1 ? c.main.toUpperCase() : c.main;
  return [c.ctrl ? "Ctrl" : "", c.alt ? "Alt" : "", c.shift ? "Shift" : "", main].filter(Boolean).join("+");
}

/** The parts of a KeyboardEvent the policy reads (a plain object in tests). */
export interface KeyEventLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  keyCode?: number;
}

export function chordOfEvent(e: KeyEventLike): Chord {
  const physical = CODE_LIKE.test(e.code) && !/^Digit/.test(e.code) ? e.code : "";
  return {
    ctrl: e.ctrlKey || e.metaKey,
    alt: e.altKey,
    shift: e.shiftKey,
    main: physical || (e.key.length === 1 ? e.key.toLowerCase() : e.key),
  };
}

/** Whether a chord written for the keymap matches an event. Digit chords match by physical key, letters by printed character. */
export function chordMatches(chord: Chord, e: KeyEventLike): boolean {
  if (chord.ctrl !== (e.ctrlKey || e.metaKey) || chord.alt !== e.altKey) return false;
  if (/^(Digit\d|Numpad\w+)$/.test(chord.main)) {
    // Shift is ignored for an unshifted digit chord: on some layouts (AZERTY) the top row needs Shift to type a digit.
    return e.code === chord.main && (!chord.shift || e.shiftKey);
  }
  if (chord.shift !== e.shiftKey) return false;
  if (CODE_LIKE.test(chord.main)) return e.code === chord.main || e.key === chord.main;
  return e.key.toLowerCase() === chord.main;
}

/** A bare key has no Ctrl/Alt/Meta (Shift alone still counts as bare: it is just a capital letter). */
export const isBare = (c: Chord) => !c.ctrl && !c.alt;

// ---- Validation ----------------------------------------------------------------------------------------------

const RESERVED_BY_BROWSER = new Set(
  ["Ctrl+W", "Ctrl+T", "Ctrl+N", "Ctrl+Shift+N", "Ctrl+Shift+T", "Ctrl+Tab", "Ctrl+Shift+Tab", "Ctrl+PageUp", "Ctrl+PageDown", "Ctrl+L", "Ctrl+Q", "Ctrl+R", "Ctrl+Shift+R", "Ctrl+Shift+W", "F5", "F11", "F12", "Alt+ArrowLeft", "Alt+ArrowRight", "Alt+F4", "Alt+Tab"].map((s) => formatChord(parseChord(s)!)),
);
/** Keys with a fixed meaning everywhere: cancel, confirm, text editing. */
const RESERVED_BY_APP = new Set(["Escape", "Enter", "Tab", "Backspace", "Delete", "Space"]);

export type Validation = { ok: true } | { ok: false; reason: string; conflict?: string };

/** Whether `command` may take `chord` given the commands' current bindings. */
export function validateBinding(command: KeyCommand, chordText: string, bindings: Record<string, string[]>): Validation {
  const chord = parseChord(chordText);
  if (!chord) return { ok: false, reason: "A shortcut is one key with optional Ctrl, Alt or Shift. Sequences of keys are not allowed." };
  const text = formatChord(chord);
  if (command.fixed) return { ok: false, reason: `${command.label} has a fixed key.` };
  if (RESERVED_BY_BROWSER.has(text)) return { ok: false, reason: `${text} belongs to the browser and cannot be used.` };
  if (RESERVED_BY_APP.has(chord.main) && !chord.ctrl && !chord.alt) return { ok: false, reason: `${chord.main} is used to cancel, confirm or edit text and cannot be reassigned.` };
  if ((command.class === "model" || command.class === "setting") && isBare(chord)) {
    return { ok: false, reason: `${command.label} changes ${command.class === "model" ? "the model" : "a setting"} immediately, so it needs Ctrl or Alt.` };
  }
  for (const [id, list] of Object.entries(bindings)) {
    const other = KEY_COMMANDS.find((c) => c.id === id);
    if (id === command.id || (other && !overlap(command, other))) continue;
    if (list.some((other) => { const o = parseChord(other); return o && formatChord(o) === text; })) {
      return { ok: false, reason: `${text} is already used by ${KEY_COMMANDS.find((c) => c.id === id)?.label ?? id}.`, conflict: id };
    }
  }
  return { ok: true };
}

/** Problems in a set of bindings (defaults or loaded from storage); empty when sound. */
export function checkKeymap(commands: KeyCommand[], bindings: Record<string, string[]>): string[] {
  const problems: string[] = [];
  const seen = new Map<string, KeyCommand[]>();
  for (const c of commands) {
    for (const text of bindings[c.id] ?? []) {
      const chord = parseChord(text);
      if (!chord) { problems.push(`${c.id}: cannot read "${text}"`); continue; }
      const v = c.fixed ? { ok: true } : validateBinding(c, text, {});
      if (!v.ok) problems.push(`${c.id}: ${(v as { reason: string }).reason}`);
      const key = formatChord(chord);
      const clash = (seen.get(key) ?? []).find((o) => overlap(o, c));
      if (clash) problems.push(`${key} is bound to both ${clash.id} and ${c.id}`);
      seen.set(key, [...(seen.get(key) ?? []), c]);
    }
  }
  return problems;
}

// ---- Keymap (defaults plus the user's changes) --------------------------------------------------------------

export interface KeymapData {
  version: 1;
  /** Turns off every bare-key shortcut; Ctrl/Alt shortcuts and the search stay. */
  singleKeys: boolean;
  /** Command id to chords, only for commands the user changed. */
  bindings: Record<string, string[]>;
}

export const defaultKeymapData = (): KeymapData => ({ version: 1, singleKeys: true, bindings: {} });

export class Keymap {
  readonly commands: KeyCommand[];
  data: KeymapData;

  constructor(commands: KeyCommand[] = KEY_COMMANDS, data: KeymapData = defaultKeymapData()) {
    this.commands = commands;
    this.data = data;
  }

  list(): KeyCommand[] {
    return this.commands;
  }

  chordsOf(id: string): string[] {
    return this.data.bindings[id] ?? this.commands.find((c) => c.id === id)?.defaults ?? [];
  }

  all(): Record<string, string[]> {
    return Object.fromEntries(this.commands.map((c) => [c.id, this.chordsOf(c.id)]));
  }

  /** The text to show next to a command: its first chord, or "". */
  hint(id: string): string {
    const first = this.chordsOf(id).find((t) => !/^Numpad/.test(t)) ?? this.chordsOf(id)[0];
    const chord = first ? parseChord(first) : null;
    if (!chord) return "";
    return formatChord({ ...chord, main: chord.main.replace(/^Digit/, "") });
  }

  /** Replace a command's chords (after validation by the caller). */
  assign(id: string, chords: string[]) {
    this.data = { ...this.data, bindings: { ...this.data.bindings, [id]: chords } };
  }

  reset(id: string) {
    const { [id]: _removed, ...rest } = this.data.bindings;
    this.data = { ...this.data, bindings: rest };
  }

  resetAll() {
    this.data = { ...this.data, bindings: {} };
  }

  /** The command an event triggers, ignoring focus and context rules. */
  find(e: KeyEventLike, sketchActive = false): KeyCommand | null {
    for (const c of this.commands) {
      if ((c.onlyInSketch && !sketchActive) || (c.notInSketch && sketchActive)) continue;
      for (const text of this.chordsOf(c.id)) {
        const chord = parseChord(text);
        if (chord && chordMatches(chord, e)) return c;
      }
    }
    return null;
  }

  /** Loads saved data, dropping anything that breaks the rules so a bad file cannot disable the app. */
  static fromJson(raw: unknown, commands: KeyCommand[] = KEY_COMMANDS): Keymap {
    const data = defaultKeymapData();
    if (raw && typeof raw === "object") {
      const r = raw as Partial<KeymapData>;
      if (r.singleKeys === false) data.singleKeys = false;
      const known = new Map(commands.map((c) => [c.id, c]));
      const merged: Record<string, string[]> = Object.fromEntries(commands.map((c) => [c.id, c.defaults]));
      for (const [id, list] of Object.entries(r.bindings ?? {})) {
        const command = known.get(id);
        if (!command || !Array.isArray(list)) continue;
        const clean = list.filter((t): t is string => typeof t === "string");
        const ok = !command.fixed && clean.every((t) => validateBinding(command, t, merged).ok);
        if (ok) { data.bindings[id] = clean; merged[id] = clean; }
      }
    }
    return new Keymap(commands, data);
  }
}

// ---- Deciding what a key press does -------------------------------------------------------------------------

export interface KeyContext {
  /** document.hasFocus() */
  pageFocused: boolean;
  /** The target is an input, textarea, select or contenteditable. */
  inTextField: boolean;
  /** A tool drag or typed value entry is live: digits, Enter, Escape and Backspace belong to it. */
  entryActive: boolean;
  /** The viewport is engaged (see Engagement). */
  engaged: boolean;
  sketchActive: boolean;
}

export type Decision =
  | { run: KeyCommand; chord: Chord }
  | { run: null; reason: "none" | "page" | "text" | "composing" | "entry" | "repeat" | "disengaged" | "off" | "sketch" };

export function decideKey(e: KeyEventLike, ctx: KeyContext, keymap: Keymap): Decision {
  if (e.isComposing || e.keyCode === 229) return { run: null, reason: "composing" };
  if (!ctx.pageFocused) return { run: null, reason: "page" };
  if (ctx.inTextField) return { run: null, reason: "text" };
  const command = keymap.find(e, ctx.sketchActive);
  if (!command) return { run: null, reason: "none" };
  if (ctx.entryActive && !command.duringDrag) return { run: null, reason: "entry" }; // also blocks undo under a live preview
  if (e.repeat && !command.repeat) return { run: null, reason: "repeat" };
  if (ctx.sketchActive && command.notInSketch) return { run: null, reason: "sketch" };
  const chord = chordOfEvent(e);
  if (isBare(chord)) {
    if (!keymap.data.singleKeys && !command.fixed) return { run: null, reason: "off" }; // fixed editing keys are not shortcuts
    if (!ctx.engaged && !command.anyFocus) return { run: null, reason: "disengaged" };
  }
  return { run: command, chord };
}

// ---- Engagement ---------------------------------------------------------------------------------------------

export const ENGAGE_GRACE_MS = 1500;

/** Tracks whether bare keys are live: pointer over the viewport (or just left it), or the viewport was clicked. */
export class Engagement {
  private over = false;
  private clicked = false;
  private leftAt = -Infinity;

  pointerEnter() { this.over = true; }
  pointerLeave(now: number) { this.over = false; this.leftAt = now; }
  /** A click in the viewport engages until focus is lost, even with the pointer elsewhere. */
  click() { this.clicked = true; this.over = true; }
  /** The window or tab lost focus: nothing is engaged until the next click or pointer entry. */
  blur() { this.over = false; this.clicked = false; this.leftAt = -Infinity; }
  /** Opening the search or a dialog takes the keyboard away from the viewport. */
  release() { this.clicked = false; this.leftAt = -Infinity; this.over = false; }
  active(now: number): boolean {
    return this.over || this.clicked || now - this.leftAt < ENGAGE_GRACE_MS;
  }
  /** Milliseconds until the state could change by itself (for scheduling a ring update); null when stable. */
  nextChange(now: number): number | null {
    if (this.over || this.clicked) return null;
    const left = ENGAGE_GRACE_MS - (now - this.leftAt);
    return left > 0 ? left : null;
  }
}
