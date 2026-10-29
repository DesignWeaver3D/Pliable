// Random muted body colors. A body's color depends only on its stable id, so it keeps the color through operations,
// the whole session and reloads of the same document.
//
// Guarantees (tested in tests/bodycolors.test.mjs): hue = id * 137.508 degrees (golden angle), saturation 32-42 %,
// lightness 62-80 % (raised per hue until the color has a WCAG contrast of at least 7:1 against the app's dark
// background), so every color is readable as text and pleasant as a surface.

export const BACKGROUND = "#1b1d22";
const MIN_CONTRAST = 7.2;

function channel(c: number): number {
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of a "#rrggbb" color. */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel(((n >> 16) & 255) / 255) + 0.7152 * channel(((n >> 8) & 255) / 255) + 0.0722 * channel((n & 255) / 255);
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

export function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

/** Hue in degrees (0-360) of body `id`. */
export function bodyHue(id: number): number {
  return (((id * 137.508 + 20) % 360) + 360) % 360;
}

const cache = new Map<number, string>();

/** CSS hex color of the body with this stable id. `index` (the body's place in the list) is not used: the id alone decides. */
export function bodyColor(id: number, index?: number): string {
  void index;
  const hit = cache.get(id);
  if (hit) return hit;
  const hue = bodyHue(id);
  const sat = 0.32 + 0.1 * (((id * 7) % 5) / 4);
  let light = 0.62 + 0.06 * (((id * 3) % 4) / 3);
  let color = hslToHex(hue, sat, light);
  while (contrast(color, BACKGROUND) < MIN_CONTRAST && light < 0.8) {
    light += 0.01;
    color = hslToHex(hue, sat, light);
  }
  cache.set(id, color);
  return color;
}
