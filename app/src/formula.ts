/** Typed formulas in number fields: numbers, + - * / ^, unary - and +, and parentheses, so a field can hold 25.4*2 or (10+5)/3.
 *  The decimal character follows the setting (numberformat.ts). Hand-written, no eval; anything else is not a formula:
 *  no functions, constants, units, names, percent or implicit multiplication yet (see docs/watchlist.md). Only fields use
 *  this (`parseExpression`); key-filtered gizmo and sketch-size entries stay numbers only. */
import { decimalChar, parseNumber } from "./numberformat.ts";
import { showNumber } from "./precision.ts";

const MAX_DEPTH = 40;

/** The value of a formula, or null when the text is not a complete, finite one (a division by zero is null). */
export function evaluate(text: string): number | null {
  const d = decimalChar() === "," ? "," : "\\.";
  const token = new RegExp(`\\s*(?:(\\d+${d}?\\d*|${d}\\d+)|([-+*/^()]))`, "y");
  const out: Array<number | string> = [];
  let at = 0;
  const src = text.trim();
  while (at < src.length) {
    token.lastIndex = at;
    const m = token.exec(src);
    if (!m) return null;
    out.push(m[1] !== undefined ? Number(m[1].replace(",", ".")) : m[2]);
    at = token.lastIndex;
  }
  if (!out.length) return null;
  let i = 0;
  let bad = false;
  // sum = product (("+"|"-") product)* ; product = unary (("*"|"/") unary)* ; unary = ("-"|"+") unary | power ; power = atom ("^" unary)?
  const sum = (depth: number): number => {
    let v = product(depth);
    while (out[i] === "+" || out[i] === "-") v = out[i++] === "+" ? v + product(depth) : v - product(depth);
    return v;
  };
  const product = (depth: number): number => {
    let v = unary(depth);
    while (out[i] === "*" || out[i] === "/") {
      const op = out[i++];
      const r = unary(depth);
      if (op === "/" && r === 0) bad = true;
      v = op === "*" ? v * r : v / r;
    }
    return v;
  };
  const unary = (depth: number): number => {
    if (out[i] === "-") {
      i++;
      return -unary(depth);
    }
    if (out[i] === "+") {
      i++;
      return unary(depth);
    }
    const base = atom(depth);
    return out[i] === "^" ? (i++, Math.pow(base, unary(depth))) : base; // right to left: 2^3^2 is 2^9; -2^2 is -(2^2)
  };
  const atom = (depth: number): number => {
    const t = out[i++];
    if (typeof t === "number") return t;
    if (t === "(" && depth < MAX_DEPTH) {
      const v = sum(depth + 1);
      if (out[i++] !== ")") bad = true;
      return v;
    }
    bad = true;
    return 0;
  };
  const v = sum(0);
  return bad || i !== out.length || !Number.isFinite(v) ? null : v;
}

/** What a field means: a plain number, or a formula. Null when blank or neither. */
export function parseExpression(text: string): number | null {
  return parseNumber(text) ?? evaluate(text);
}

/** "= 10" for a field holding a formula (not for a plain number), else null: shown beside the field so the result is seen. */
export function formulaEcho(text: string): string | null {
  if (parseNumber(text) !== null) return null;
  const v = evaluate(text);
  return v === null ? null : `= ${showNumber(v, 4)}`;
}
