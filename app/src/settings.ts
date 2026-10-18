/** User settings kept in the browser. Read the values through `settings`; they change live. */
export interface Settings {
  /** Pick radius in pixels for edges. */
  edgePickPx: number;
  /** Pick radius in pixels for vertices and hole centres. */
  vertexPickPx: number;
  /** Draw the model translucent and let edges and faces behind it be picked (see-through). */
  seeThrough: boolean;
}

const KEY = "pliable.settings";
const DEFAULTS: Settings = { edgePickPx: 5, vertexPickPx: 8, seeThrough: false };

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
  button.title = "Settings";
  const panel = document.createElement("div");
  panel.id = "settingspanel";
  panel.hidden = true;
  const slider = (label: string, key: "edgePickPx" | "vertexPickPx", min: number, max: number, hint: string) => {
    const row = document.createElement("label");
    row.title = hint;
    const text = document.createElement("span");
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = "1";
    const show = () => (text.textContent = `${label}: ${settings[key]} px`);
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
  check.onchange = () => updateSettings({ seeThrough: check.checked });
  seeThrough.append(check, " See-through");
  onSettingsChange(() => (check.checked = settings.seeThrough));
  const heading = document.createElement("b");
  heading.textContent = "Settings";
  const reset = document.createElement("button");
  reset.textContent = "Reset picking";
  reset.onclick = () => {
    updateSettings({ edgePickPx: DEFAULTS.edgePickPx, vertexPickPx: DEFAULTS.vertexPickPx });
    panel.replaceChildren(...build());
  };
  const build = () => [
    heading,
    slider("Edge pick range", "edgePickPx", 1, 14, "How close the pointer must be to an edge to pick it. Lower it to reach small faces."),
    slider("Point pick range", "vertexPickPx", 1, 16, "How close the pointer must be to a vertex or hole centre to pick it."),
    seeThrough,
    reset,
  ];
  panel.append(...build());
  button.onclick = () => (panel.hidden = !panel.hidden);
  host.append(button, panel);
}
