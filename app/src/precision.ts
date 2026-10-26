/** The global display precision: how many decimals the interface shows for lengths and values. Zeros after the last
 *  digit are never shown ("10", not "10.000"), so a number with few decimals stays short. The settings window sets it
 *  (`displayDecimals`); this module has no imports so any file, including the tested sketch model, can use it. */
export const DEFAULT_DECIMALS = 3;
export const MAX_DECIMALS = 8;

let places = DEFAULT_DECIMALS;

export function setDecimals(n: number): void {
  places = Number.isFinite(n) ? Math.min(MAX_DECIMALS, Math.max(0, Math.round(n))) : DEFAULT_DECIMALS;
}

export function decimals(): number {
  return places;
}

/** The number as text with at most the global number of decimals (or `atLeast` when a field needs more), no trailing zeros, never "-0". */
export function showNumber(v: number, atLeast = 0): string {
  return String(parseFloat(v.toFixed(Math.max(places, atLeast))) + 0);
}
