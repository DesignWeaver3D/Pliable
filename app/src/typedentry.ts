/** Typed entry of one or more numbers while a gizmo is dragged: the same keys as a handle's entry (digits, ".", "-" to flip the sign, Backspace),
 *  with Tab moving to the next field. It holds the text only; each gizmo says what the numbers mean (see pullgizmo.ts and manipulator.ts). */
import { typedStep } from "./manipulator.ts";

export class TypedFields {
  texts: (string | null)[];
  negatives: boolean[];
  active = 0;
  private readonly whole: boolean;

  /** `count` fields; with `whole` set only digits are taken (counts), and no sign. */
  constructor(count: number, whole = false) {
    this.whole = whole;
    this.texts = Array(count).fill(null);
    this.negatives = Array(count).fill(false);
  }

  /** One key of entry for the active field: whether it was used. Tab moves to the next field (round to the first). */
  key(key: string): boolean {
    if (key === "Tab") {
      if (this.texts.length < 2) return false;
      this.active = (this.active + 1) % this.texts.length;
      return true;
    }
    if (this.whole && !/^([0-9]|Backspace)$/.test(key)) return false;
    const step = typedStep(this.texts[this.active], this.negatives[this.active], key);
    if (!step) return false;
    this.texts[this.active] = step.text;
    this.negatives[this.active] = step.negative;
    return true;
  }

  /** The number typed in a field, or null while it holds nothing usable. */
  value(i: number): number | null {
    const text = this.texts[i];
    const n = text === null || text === "" || text === "." ? NaN : Number(text);
    return Number.isFinite(n) ? (this.negatives[i] ? -n : n) : null;
  }

  /** The field as shown in a label: its text with a caret while it is the active one, else `fallback`. */
  shown(i: number, fallback: string): string {
    const text = this.texts[i];
    if (text === null) return fallback;
    return `${this.negatives[i] ? "-" : ""}${text}${i === this.active ? "|" : ""}`;
  }
}

/** The counts a grid grip's typed entry asks for: each field typed (whole, at least 1) or the grip's current count. */
export function typedCounts(fields: TypedFields, current: { columns: number; rows: number }): { columns: number; rows: number } {
  const pick = (i: number, now: number) => {
    const n = fields.value(i);
    return n === null ? now : Math.max(1, Math.round(n));
  };
  return { columns: pick(0, current.columns), rows: pick(1, current.rows) };
}
