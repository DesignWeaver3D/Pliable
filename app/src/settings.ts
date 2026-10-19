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
}

const KEY = "pliable.settings";
const DEFAULTS: Settings = { edgePickPx: 5, vertexPickPx: 8, seeThrough: false, seeThroughOpacity: 12, sharpAngle: 30, boxKind: "auto" };

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
  const heading = document.createElement("b");
  heading.textContent = "Settings";
  const reset = document.createElement("button");
  reset.textContent = "Reset picking";
  reset.title = "Put the edge and point pick ranges back to their default values";
  reset.onclick = () => {
    updateSettings({ edgePickPx: DEFAULTS.edgePickPx, vertexPickPx: DEFAULTS.vertexPickPx });
    panel.replaceChildren(...build());
  };
  const build = () => [
    heading,
    slider("Edge pick range", "edgePickPx", 1, 14, "How close the pointer must be to an edge to pick it. Lower it to reach small faces."),
    slider("Point pick range", "vertexPickPx", 1, 16, "How close the pointer must be to a vertex or hole centre to pick it."),
    slider("Sharp edge angle", "sharpAngle", 5, 90, "Sharp edges selects connected edges whose faces meet at this angle or more."),
    boxRow,
    seeThrough,
    slider("See-through opacity", "seeThroughOpacity", 0, 60, "How visible the faces stay while see-through is on. 0 is fully clear; higher shows the surface more."),
    reset,
  ];
  panel.append(...build());
  button.onclick = () => (panel.hidden = !panel.hidden);
  host.append(button, panel);
}
