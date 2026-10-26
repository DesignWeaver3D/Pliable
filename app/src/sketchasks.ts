/** The small ask strips of the sketch panel: several numbers at once, and one value with a Reference box. Moved out of sketch.ts. */
import { showNumber } from "./precision.ts";

/** Several numbers at once (and optionally a Copy box) in the ask strip. Resolves null when cancelled. */
export function askForm(panel: HTMLElement, title: string, fields: { label: string; value: number; integer?: boolean }[], copy?: boolean): Promise<{ values: number[]; copy: boolean } | null> {
  return new Promise((resolve) => {
    const box = panel.querySelector<HTMLElement>(".ask")!;
    box.hidden = false;
    box.replaceChildren();
    const inputs = fields.map((f) => {
      const input = document.createElement("input");
      input.type = "number";
      input.step = f.integer ? "1" : "any";
      input.value = showNumber(f.value);
      input.title = f.label;
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") ok.click();
        else if (e.key === "Escape") done(null);
      });
      return input;
    });
    const copyBox = document.createElement("input");
    copyBox.type = "checkbox";
    copyBox.checked = copy ?? false;
    const done = (values: number[] | null) => {
      box.hidden = true;
      box.replaceChildren();
      resolve(values ? { values, copy: copyBox.checked } : null);
    };
    const ok = document.createElement("button");
    ok.textContent = "OK";
    ok.addEventListener("click", () => {
      const values = inputs.map((i) => Number(i.value));
      done(values.every(Number.isFinite) ? values : null);
    });
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => done(null));
    const rows = fields.map((f, k) => {
      const label = document.createElement("label");
      label.append(`${f.label} `, inputs[k]);
      return label;
    });
    const copyLabel = document.createElement("label");
    copyLabel.append(copyBox, " Copy");
    box.append(title, ...rows, ...(copy === undefined ? [] : [copyLabel]), ok, cancel);
    inputs[0]?.focus();
    inputs[0]?.select();
  });
}

export function askNumber(panel: HTMLElement, label: string, initial: number): Promise<{ value: number; reference: boolean } | null> {
  return new Promise((resolve) => {
    const box = panel.querySelector<HTMLElement>(".ask")!;
    box.hidden = false;
    box.replaceChildren();
    const text = document.createElement("span");
    text.textContent = label;
    const input = document.createElement("input");
    input.type = "number";
    input.step = "any";
    input.value = showNumber(initial);
    const reference = document.createElement("input");
    reference.type = "checkbox";
    reference.title = "Only show this measurement; it does not change the shape";
    const referenceLabel = document.createElement("label");
    referenceLabel.append(reference, " Reference");
    const done = (value: number | null) => {
      box.hidden = true;
      box.replaceChildren();
      resolve(value === null ? null : { value: reference.checked ? initial : value, reference: reference.checked });
    };
    const ok = document.createElement("button");
    ok.textContent = "OK";
    ok.title = "Accept this value";
    ok.addEventListener("click", () => done(Number.isFinite(Number(input.value)) ? Number(input.value) : null));
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.title = "Leave the value unchanged";
    cancel.addEventListener("click", () => done(null));
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") ok.click();
      else if (e.key === "Escape") done(null);
    });
    box.append(text, input, referenceLabel, ok, cancel);
    input.focus();
    input.select();
  });
}
