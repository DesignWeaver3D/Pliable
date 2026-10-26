import { uiIcon } from "./icons.ts";
import { setDecimals, DEFAULT_DECIMALS, MAX_DECIMALS } from "./precision.ts";
import { MATERIALS, DEFAULT_MATERIAL_ID, getMaterial } from "./materials.ts";
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
  /** Draw bodies as semi-gloss plastic with studio reflections; off gives the previous flat look. */
  glossyLook: boolean;
  /** Id of the default material: the look of the bodies and the mass of bodies that have no material of their own (see materials.ts). */
  material: string;
  /** Decimals shown for lengths and values (zeros after the last digit are never shown). */
  displayDecimals: number;
}

const KEY = "pliable.settings";
const DEFAULTS: Settings = { edgePickPx: 5, vertexPickPx: 8, seeThrough: false, seeThroughOpacity: 12, sharpAngle: 30, boxKind: "auto", randomBodyColors: true, glossyLook: true, material: DEFAULT_MATERIAL_ID, displayDecimals: DEFAULT_DECIMALS };

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
setDecimals(settings.displayDecimals);

export function onSettingsChange(fn: () => void) {
  listeners.push(fn);
}

export function updateSettings(patch: Partial<Settings>) {
  Object.assign(settings, patch);
  setDecimals(settings.displayDecimals);
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
  { id: "displayDecimals", label: "Display precision", keywords: ["decimals", "rounding", "digits", "places", "numbers", "dimensions"] },
  { id: "sharpAngle", label: "Sharp edge angle", keywords: ["crease", "select edges", "degrees"] },
  { id: "boxKind", label: "Box selects", keywords: ["marquee", "rubber band", "drag box", "edges", "faces", "vertices"] },
  { id: "seeThrough", label: "See-through", keywords: ["transparent", "x ray", "hidden edges"] },
  { id: "seeThroughOpacity", label: "See-through opacity", keywords: ["transparency", "alpha", "faces"] },
  { id: "randomBodyColors", label: "Random body colours", keywords: ["colour", "color", "muted", "bodies", "solids", "names", "tint"] },
  { id: "glossyLook", label: "Glossy plastic look", keywords: ["material", "shiny", "gloss", "realistic", "reflection", "flat", "graphics", "slow"] },
  { id: "material", label: "Default material", keywords: ["body", "plastic", "pla", "petg", "abs", "asa", "resin", "metal", "steel", "aluminium", "copper", "gold", "silver", "titanium", "cobalt", "look", "density"] },
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
    case "displayDecimals":
      return `${settings.displayDecimals} decimals`;
    case "seeThroughOpacity":
      return `${settings.seeThroughOpacity} %`;
    case "seeThrough":
      return settings.seeThrough ? "on" : "off";
    case "material":
      return getMaterial(settings.material)?.name ?? "";
    case "glossyLook":
      return settings.glossyLook ? "on" : "off";
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
  button.append(uiIcon("gear", 20)); // the drawn gear, the same one the sketch card uses (the text glyph drew dark on some systems)
  button.title = "Settings: how close the pointer must be to pick edges and vertices, and display options";
  const panel = document.createElement("div");
  panel.id = "settingspanel";
  panel.hidden = true;
  const slider = (label: string, key: "edgePickPx" | "vertexPickPx" | "sharpAngle" | "seeThroughOpacity" | "displayDecimals", min: number, max: number, hint: string) => {
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
    const unit = key === "sharpAngle" ? "°" : key === "seeThroughOpacity" ? " %" : key === "displayDecimals" ? " decimals" : " px";
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
  boxRow.title = "What dragging a box selects. All takes faces, edges and vertices together; holding F, E or V while dragging restricts it to one kind.";
  const boxText = document.createElement("span");
  boxText.textContent = "Box selects";
  const boxSelect = document.createElement("select");
  for (const [value, name] of [["auto", "All (faces, edges, vertices)"], ["edge", "Edges"], ["face", "Faces"], ["vertex", "Vertices"]]) {
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
  const glossRow = document.createElement("label");
  glossRow.title = "Draw bodies as semi-gloss plastic with soft reflections. Turn off for the flat look, which is lighter on slow graphics";
  const glossCheck = document.createElement("input");
  glossCheck.type = "checkbox";
  glossCheck.checked = settings.glossyLook;
  glossCheck.title = glossRow.title;
  glossCheck.onchange = () => updateSettings({ glossyLook: glossCheck.checked });
  glossRow.append(glossCheck, " Glossy plastic look");
  onSettingsChange(() => (glossCheck.checked = settings.glossyLook));
  const matRow = document.createElement("label");
  matRow.title = "The material of every body that has none of its own (right-click a body in the body list to give it one) and what the bodies look like. Plastics and resins keep the random body colours; metals show their own colour and ignore them. Needs the glossy plastic look (off gives the flat look for every material)";
  const matText = document.createElement("span");
  matText.textContent = "Default material ";
  const matSelect = document.createElement("select");
  for (const group of ["Plastic", "Resin", "Metal"]) {
    const og = document.createElement("optgroup");
    og.label = group;
    for (const m of MATERIALS.filter((x) => x.group === group)) {
      const o = document.createElement("option");
      o.value = m.id;
      o.textContent = m.name;
      og.append(o);
    }
    matSelect.append(og);
  }
  matSelect.title = matRow.title;
  matSelect.value = settings.material;
  matSelect.onchange = () => updateSettings({ material: matSelect.value });
  matRow.append(matText, matSelect);
  onSettingsChange(() => (matSelect.value = settings.material));
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
    glossRow.dataset.setting = "glossyLook";
    matRow.dataset.setting = "material";
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
    slider("Display precision", "displayDecimals", 1, MAX_DECIMALS, "How many decimals lengths and values show, up to 8. Zeros after the last digit are never shown, so 10 stays 10. Values dragged with the mouse are still rounded to 0.001 when they are made."),
    slider("Sharp edge angle", "sharpAngle", 5, 90, "Sharp edges selects connected edges whose faces meet at this angle or more."),
    boxRow,
    seeThrough,
    slider("See-through opacity", "seeThroughOpacity", 0, 60, "How visible the faces stay while see-through is on. 0 is fully clear; higher shows the surface more."),
    colorsRow,
    glossRow,
    matRow,
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
