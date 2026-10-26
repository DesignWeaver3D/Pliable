import type { Dimension } from "./dimensions";
import { showNumber } from "./precision.ts";

/** Measurement panel: label/value rows for the current selection, from the core's `measure` reply. */

export interface MeasureRow {
  label: string;
  value: number | number[] | string;
  unit: string;
}

export interface Measured {
  kind: string;
  id: number;
  title: string;
  rows: MeasureRow[];
  anchor: number[];
  dimensions: Dimension[];
}

export interface MeasureReply {
  items: Measured[];
  summary: MeasureRow[];
  /** What to draw on the model: the single item dimensions, or the group dimension for several. */
  dimensions: Dimension[];
}

const MAX_ITEMS_SHOWN = 3; // more items than this collapse into the summary alone

/** Numbers without trailing zeros; a vector as (x, y, z). */
export function formatValue(value: number | number[] | string, unit: string): string {
  if (typeof value === "string") return value;
  const one = (n: number) => showNumber(n);
  const text = Array.isArray(value) ? `(${value.map(one).join(", ")})` : one(value);
  return unit ? `${text}${unit}` : text;
}

export class MeasurePanel {
  constructor(private readonly el: HTMLElement) {
    el.classList.add("collapsed"); // starts short: the first rows of the first item; a click on a title shows or hides the rest
    el.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".title")) {
        el.classList.toggle("collapsed");
        return;
      }
      const row = (e.target as HTMLElement).closest<HTMLElement>(".row");
      if (!row?.dataset.copy) return;
      navigator.clipboard?.writeText(row.dataset.copy).catch(() => {});
      row.classList.add("copied");
      setTimeout(() => row.classList.remove("copied"), 600);
    });
  }

  hide() {
    this.el.hidden = true;
  }

  show(reply: MeasureReply) {
    this.el.replaceChildren();
    const items = reply.items.length <= MAX_ITEMS_SHOWN ? reply.items : [];
    for (const item of items) {
      this.section(reply.items.length > 1 ? `${item.title} ${item.id}` : item.title, item.rows);
    }
    if (reply.summary.length) this.section(items.length ? "Together" : `${reply.items.length} ${reply.items[0].kind}s`, reply.summary);
    this.el.hidden = this.el.childElementCount === 0;
  }

  private section(title: string, rows: MeasureRow[]) {
    const box = document.createElement("div");
    box.className = "section";
    const heading = document.createElement("div");
    heading.className = "title";
    heading.textContent = title;
    box.append(heading);
    for (const r of rows) {
      const line = document.createElement("div");
      line.className = "row";
      const text = formatValue(r.value, r.unit);
      // Copy the bare number for scalars, the formatted text for vectors.
      line.dataset.copy = typeof r.value === "number" ? showNumber(r.value) : text;
      line.title = "Click to copy";
      const label = document.createElement("span");
      label.textContent = r.label;
      const value = document.createElement("span");
      value.className = "value";
      value.textContent = text;
      line.append(label, value);
      box.append(line);
    }
    this.el.append(box);
  }
}
