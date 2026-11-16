import type { Dimension } from "./dimensions.ts";
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

const COLLAPSED_KEY = "pliable.measure.collapsed";
const MAX_ITEMS_SHOWN = 3; // more items than this collapse into the summary alone

/** Numbers without trailing zeros; a vector as (x, y, z). */
export function formatValue(value: number | number[] | string, unit: string): string {
  if (typeof value === "string") return value;
  const one = (n: number) => showNumber(n);
  const text = Array.isArray(value) ? `(${value.map(one).join(", ")})` : one(value);
  return unit ? `${text}${unit}` : text;
}

export class MeasurePanel {
  private readonly body: HTMLElement;

  /** `el` holds the always-visible "Selection Information" heading (a click shows or hides the measurements, remembered on this computer) and the body the measurements go in. */
  constructor(el: HTMLElement) {
    this.body = el.querySelector<HTMLElement>("#measurebody")!;
    try {
      el.classList.toggle("collapsed", localStorage.getItem(COLLAPSED_KEY) === "1");
    } catch {
      /* not remembered */
    }
    const toggle = () => {
      const collapsed = el.classList.toggle("collapsed");
      try {
        localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
      } catch {
        /* not remembered */
      }
    };
    el.querySelector<HTMLElement>("#measurehead")!.addEventListener("click", toggle);
    el.addEventListener("click", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>(".row");
      if (!row?.dataset.copy) return;
      navigator.clipboard?.writeText(row.dataset.copy).catch(() => {});
      row.classList.add("copied");
      setTimeout(() => row.classList.remove("copied"), 600);
    });
  }

  hide() {
    this.body.replaceChildren();
  }

  show(reply: MeasureReply) {
    this.body.replaceChildren();
    const items = reply.items.length <= MAX_ITEMS_SHOWN ? reply.items : [];
    for (const item of items) {
      this.section(reply.items.length > 1 ? `${item.title} ${item.id}` : item.title, item.rows);
    }
    if (reply.summary.length) this.section(items.length ? "Together" : `${reply.items.length} ${reply.items[0].kind}s`, reply.summary);
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
    this.body.append(box);
  }
}
