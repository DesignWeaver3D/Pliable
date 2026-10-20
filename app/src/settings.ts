/** User settings kept in the browser. Read the values through `settings`; they change live. */
export interface Settings {
  /** Pick radius in pixels for edges. */
  edgePickPx: number;
  /** Pick radius in pixels for vertices and hole centres. */
  vertexPickPx: number;
  /** Draw the model translucent and let edges and faces behind it be picked (see-through). */
  seeThrough: boolean;
  /** Face opacity in percent while see-through is on (0 to 60). */
  seeThroughOpacity: number;
  /** Minimum angle in degrees between faces for the Sharp edges selection. */
  sharpAngle: number;
  /** What a box selection picks: "auto" follows the current selection (edges when empty). */
  boxKind: "auto" | "edge" | "face" | "vertex";
  /** Give every body its own muted colour in the 3D view and the body list. */
  randomBodyColors: boolean;
}

const KEY = "pliable.settings";
const DEFAULTS: Settings = { edgePickPx: 5, vertexPickPx: 8, seeThrough: false, seeThroughOpacity: 12, sharpAngle: 30, boxKind: "auto", randomBodyColors: true };

export const settings: Settings = { ...DEFAULTS };
const listeners: Array<() => void> = [];

try {
  const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
  for (const k of Object.keys(DEFAULTS) as Array<keyof Settings>) {
    if (typeof saved[k] === typeof DEFAULTS[k]) (settings as any)[k] = saved[k];
  }
} catch {
  /* storage can be blocked; defaults apply */
}

export function onSettingsChange(fn: () => void) {
  listeners.push(fn);
}

export function updateSettings(patch: Partial<Settings>) {
  Object.assign(settings, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => fn());
}

let openKeys: (() => void) | null = null;
/** The keyboard shortcuts dialog is owned by the key router, which is created after the settings window. */
export function setKeysOpener(fn: () => void) {
  openKeys = fn;
}

/** Hints on/off live in the hint module; main.ts connects them so the settings window can show the switch. */
let hintsBinding: { get: () => boolean; set: (on: boolean) => void } | null = null;
export function setHintsBinding(b: { get: () => boolean; set: (on: boolean) => void }) {
  hintsBinding = b;
}

/** Every row of the settings window, for the command search. `id` is the row's data-setting value. */
export const SETTING_ENTRIES: { id: string; label: string; keywords: string[] }[] = [
  { id: "edgePickPx", label: "Edge pick range", keywords: ["select", "radius", "reach", "pixels"] },
  { id: "vertexPickPx", label: "Point pick range", keywords: ["vertex", "hole centre", "snap", "radius", "pixels"] },
  { id: "sharpAngle", label: "Sharp edge angle", keywords: ["crease", "select edges", "degrees"] },
  { id: "boxKind", label: "Box selects", keywords: ["marquee", "rubber band", "drag box", "edges", "faces", "vertices"] },
  { id: "seeThrough", label: "See-through", keywords: ["transparent", "x ray", "hidden edges"] },
  { id: "seeThroughOpacity", label: "See-through opacity", keywords: ["transparency", "alpha", "faces"] },
  { id: "randomBodyColors", label: "Random body colours", keywords: ["colour", "color", "muted", "bodies", "solids", "names", "tint"] },
  { id: "hints", label: "Hints", keywords: ["tips", "help line", "learning", "turn off"] },
  { id: "keys", label: "Keyboard shortcuts", keywords: ["hotkeys", "bindings", "rebind"] },
];

/** Current value text for a setting row, shown beside it in the search. */
export function settingValue(id: string): string {
  switch (id) {
    case "edgePickPx":
    case "vertexPickPx":
      return `${settings[id]} px`;
    case "sharpAngle":
      return `${settings.sharpAngle}°`;
    case "seeThroughOpacity":
      return `${settings.seeThroughOpacity} %`;
    case "seeThrough":
      return settings.seeThrough ? "on" : "off";
    case "randomBodyColors":
      return settings.randomBodyColors ? "on" : "off";
    case "boxKind":
      return settings.boxKind;
    case "hints":
      return hintsBinding ? (hintsBinding.get() ? "on" : "off") : "";
    default:
      return "";
  }
}

let showSettings: ((id?: string) => void) | null = null;
/** Open the settings window and highlight one row (by SETTING_ENTRIES id). */
export function openSettings(id?: string) {
  showSettings?.(id);
}

/** A gear button that opens a small settings window inside `host`. */
export function createSettingsWindow(host: HTMLElement) {
  const button = document.createElement("button");
  button.id = "gear";
  button.textContent = "⚙";
  button.title = "Settings: how close the pointer must be to pick edges and vertices, and display options";
  const panel = document.createElement("div");
  panel.id = "settingspanel";
  panel.hidden = true;
  const slider = (label: string, key: "edgePickPx" | "vertexPickPx" | "sharpAngle" | "seeThroughOpacity", min: number, max: number, hint: string) => {
    const row = document.createElement("label");
    row.title = hint;
    row.dataset.setting = key;
    const text = document.createElement("span");
    const input = document.createElement("input");
    input.type = "range";
    input.title = hint;
    input.min = String(min);
    input.max = String(max);
    input.step = "1";
    const unit = key === "sharpAngle" ? "°" : key === "seeThroughOpacity" ? " %" : " px";
    const show = () => (text.textContent = `${label}: ${settings[key]}${unit}`);
    input.value = String(settings[key]);
    input.oninput = () => {
      updateSettings({ [key]: Number(input.value) });
      show();
    };
    show();
    row.append(text, input);
    return row;
  };
  const seeThrough = document.createElement("label");
  seeThrough.title = "Draw the model translucent and pick edges and faces hidden behind it (key X)";
  const check = document.createElement("input");
  check.type = "checkbox";
  check.checked = settings.seeThrough;
  check.title = seeThrough.title;
  check.onchange = () => updateSettings({ seeThrough: check.checked });
  seeThrough.append(check, " See-through");
  onSettingsChange(() => (check.checked = settings.seeThrough));
  const boxRow = document.createElement("label");
  boxRow.title = "What dragging a box selects. Auto keeps the kind already selected, or edges if nothing is.";
  const boxText = document.createElement("span");
  boxText.textContent = "Box selects";
  const boxSelect = document.createElement("select");
  for (const [value, name] of [["auto", "Auto (current kind)"], ["edge", "Edges"], ["face", "Faces"], ["vertex", "Vertices"]]) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = name;
    boxSelect.append(o);
  }
  boxSelect.title = boxRow.title;
  boxSelect.value = settings.boxKind;
  boxSelect.onchange = () => updateSettings({ boxKind: boxSelect.value as Settings["boxKind"] });
  boxRow.append(boxText, boxSelect);
  const colorsRow = document.createElement("label");
  colorsRow.title = "Give every body its own muted colour in the 3D view, with its name in the body list in the same colour";
  const colorsCheck = document.createElement("input");
  colorsCheck.type = "checkbox";
  colorsCheck.checked = settings.randomBodyColors;
  colorsCheck.title = colorsRow.title;
  colorsCheck.onchange = () => updateSettings({ randomBodyColors: colorsCheck.checked });
  colorsRow.append(colorsCheck, " Random body colours");
  onSettingsChange(() => (colorsCheck.checked = settings.randomBodyColors));
  const hintsRow = document.createElement("label");
  hintsRow.title = "Show the key hint line and first-use tips at the bottom of the view";
  const hintsCheck = document.createElement("input");
  hintsCheck.type = "checkbox";
  hintsCheck.checked = hintsBinding?.get() ?? true;
  hintsCheck.title = hintsRow.title;
  hintsCheck.onchange = () => hintsBinding?.set(hintsCheck.checked);
  hintsRow.append(hintsCheck, " Hints and tips");
  const heading = document.createElement("b");
  heading.textContent = "Settings";
  const reset = document.createElement("button");
  reset.textContent = "Reset picking";
  reset.title = "Put the edge and point pick ranges back to their default values";
  reset.onclick = () => {
    updateSettings({ edgePickPx: DEFAULTS.edgePickPx, vertexPickPx: DEFAULTS.vertexPickPx });
    panel.replaceChildren(...build());
  };
  const keysButton = document.createElement("button");
  keysButton.textContent = "Keyboard shortcuts...";
  keysButton.title = "See and change the keyboard shortcuts (also: press ? or search for shortcuts)";
  keysButton.onclick = () => {
    panel.hidden = true;
    openKeys?.();
  };
  const build = () => {
    seeThrough.dataset.setting = "seeThrough";
    boxRow.dataset.setting = "boxKind";
    hintsRow.dataset.setting = "hints";
    colorsRow.dataset.setting = "randomBodyColors";
    keysButton.dataset.setting = "keys";
    check.checked = settings.seeThrough;
    boxSelect.value = settings.boxKind;
    hintsCheck.checked = hintsBinding?.get() ?? true;
    return rows();
  };
  const rows = () => [
    heading,
    slider("Edge pick range", "edgePickPx", 1, 14, "How close the pointer must be to an edge to pick it. Lower it to reach small faces."),
    slider("Point pick range", "vertexPickPx", 1, 16, "How close the pointer must be to a vertex or hole centre to pick it."),
    slider("Sharp edge angle", "sharpAngle", 5, 90, "Sharp edges selects connected edges whose faces meet at this angle or more."),
    boxRow,
    seeThrough,
    slider("See-through opacity", "seeThroughOpacity", 0, 60, "How visible the faces stay while see-through is on. 0 is fully clear; higher shows the surface more."),
    colorsRow,
    hintsRow,
    reset,
    keysButton,
  ];
  panel.append(...build());
  button.onclick = () => {
    if (panel.hidden) panel.replaceChildren(...build());
    panel.hidden = !panel.hidden;
  };
  showSettings = (id) => {
    panel.replaceChildren(...build());
    panel.hidden = false;
    const row = id ? panel.querySelector<HTMLElement>(`[data-setting="${id}"]`) : null;
    if (!row) return;
    row.classList.add("found");
    row.scrollIntoView({ block: "nearest" });
    row.querySelector<HTMLElement>("input,select,button")?.focus({ preventScroll: true });
    window.setTimeout(() => row.classList.remove("found"), 4000);
  };
  host.append(button, panel);
  // Close on any press outside the window (capture phase, so the 3D view cannot swallow it).
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!panel.hidden && !panel.contains(e.target as Node) && !button.contains(e.target as Node)) panel.hidden = true;
    },
    true,
  );
}
