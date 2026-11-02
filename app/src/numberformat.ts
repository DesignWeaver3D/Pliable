/** How the interface reads typed numbers. One setting decides the decimal character: the point (default) or, for
 *  people who write 12,5, the comma. Every place that turns typed text into a number goes through `parseNumber`, and
 *  every key-filtered entry takes its allowed characters from `allowedChars`, so the setting reaches all of them.
 *  The core never sees the setting: it receives numbers, and stored formulas use the point. The settings window sets it
 *  (`decimalComma`); this module has no imports so any file, including the tested models, can use it. */
let comma = false;

export function setDecimalComma(on: boolean): void {
  comma = on;
}

export function decimalComma(): boolean {
  return comma;
}

/** The character that separates the whole part from the decimals while typing. */
export function decimalChar(): string {
  return comma ? "," : ".";
}

/** A typed number, or null when the text is not one. Only digits, an optional leading sign and one decimal character
 *  are accepted: no exponent, no hex, no thousands separators, no trailing text, and the other decimal character is
 *  an error (so 1,000 is never read as 1 in point mode). Blank is not a number. */
export function parseNumber(text: string): number | null {
  const t = text.trim();
  const d = comma ? "," : "\\.";
  if (!new RegExp(`^[-+]?(\\d+${d}?\\d*|${d}\\d+)$`).test(t)) return null;
  return Number(t.replace(",", "."));
}

/** True for a character that may be typed into a number entry: a digit, a sign or the decimal character. */
export function allowedChars(ch: string): boolean {
  return /^[0-9+-]$/.test(ch) || ch === decimalChar();
}
