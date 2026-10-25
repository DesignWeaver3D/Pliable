/** The sketch settings window (grid spacing, fade, automatic constraints). Moved out of sketch.ts. */
import type { SketchOptions } from "./sketch";
import { LENGTH_UNIT } from "./units";

export interface SettingsHooks {
  /** Store the options (they are kept between sessions). */
  save(): void;
  /** Redraw the grid after a grid option changed. */
  rebuildGrid(): void;
  /** The window was closed. */
  closed(): void;
}

/** Open the modal window; the options object is edited in place. */
export function openSketchSettings(options: SketchOptions, hooks: SettingsHooks): HTMLDialogElement {
  const dialog = document.createElement("dialog");
  dialog.className = "sketchsettings";
  dialog.addEventListener("keydown", (e) => e.stopPropagation()); // typing here is not a sketch shortcut
  const row = (label: string, input: HTMLElement, unit = "") => {
    const r = document.createElement("label");
    const text = document.createElement("span");
    text.textContent = label;
    const tail = document.createElement("span");
    tail.className = "unit";
    tail.textContent = unit;
    r.append(text, input, tail);
    return r;
  };
  const spacing = (value: number, min: number, on: (n: number) => void) => {
    const input = document.createElement("input");
    input.type = "number";
    input.min = String(min);
    input.step = "any";
    input.value = String(value);
    input.addEventListener("change", () => {
      const n = Number(input.value);
      if (Number.isFinite(n) && n >= min) on(n);
      input.value = String(n >= min ? n : value);
      hooks.save();
      hooks.rebuildGrid();
    });
    return input;
  };
  const auto = document.createElement("select");
  for (const [value, label] of [["none", "Off: geometry stays free"], ["snaps", "From snaps only"], ["shape", "Snaps and shapes"]]) auto.append(new Option(label, value, false, value === options.auto));
  auto.title = "Off: drawing tools never add constraints, so everything moves freely until you constrain it. From snaps: a line snapped to horizontal or vertical, or a point snapped onto a curve, keeps that. Snaps and shapes: also keeps rectangles, polygons and slots in shape";
  auto.addEventListener("change", () => {
    options.auto = auto.value as SketchOptions["auto"];
    hooks.save();
  });
  const fade = document.createElement("select");
  for (const [value, label] of [["off", "Off"], ["subtle", "Subtle"], ["strong", "Strong"]]) fade.append(new Option(label, value, false, value === options.fade));
  fade.title = "Fades the grid toward the edges of the view. It is always measured from the middle of the view, so panning never hides the grid where you are looking";
  fade.addEventListener("change", () => {
    options.fade = fade.value as SketchOptions["fade"];
    hooks.save();
    hooks.rebuildGrid();
  });
  const title = document.createElement("h3");
  title.textContent = "Sketch settings";
  const grid = document.createElement("div");
  grid.className = "group";
  grid.textContent = "Grid (shown with the grid button in the sketch card)";
  const done = document.createElement("button");
  done.textContent = "Done";
  done.addEventListener("click", () => dialog.close());
  dialog.append(
    title,
    grid,
    row("Major spacing", spacing(options.major, 0.001, (n) => (options.major = n)), LENGTH_UNIT),
    row("Minor spacing", spacing(options.minor, 0, (n) => (options.minor = n)), `${LENGTH_UNIT} (0 for none)`),
    row("Fade at the edges", fade),
    Object.assign(document.createElement("div"), { className: "group", textContent: "Drawing" }),
    row("Automatic constraints", auto),
    done,
  );
  dialog.addEventListener("close", () => {
    dialog.remove();
    hooks.closed();
  });
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}
