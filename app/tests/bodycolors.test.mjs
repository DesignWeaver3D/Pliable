import test from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND, bodyColor, bodyHue, contrast } from "../src/bodycolors.ts";

function hsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  return { s: s * 100, l: l * 100 };
}

test("every color is readable on the dark background (contrast at least 7:1)", () => {
  for (let id = 1; id <= 500; id++) assert.ok(contrast(bodyColor(id), BACKGROUND) >= 7, `id ${id} ${bodyColor(id)}`);
});

test("colors stay muted: saturation and lightness inside the bounds", () => {
  for (let id = 1; id <= 500; id++) {
    const { s, l } = hsl(bodyColor(id));
    assert.ok(s >= 28 && s <= 47, `saturation ${s} for id ${id}`);
    assert.ok(l >= 61 && l <= 81, `lightness ${l} for id ${id}`);
  }
});

test("the first twelve ids have clearly different hues", () => {
  for (let a = 1; a <= 12; a++)
    for (let b = a + 1; b <= 12; b++) {
      const d = Math.abs(bodyHue(a) - bodyHue(b));
      assert.ok(Math.min(d, 360 - d) >= 20, `ids ${a} and ${b}`);
    }
});

test("the same id always gives the same color", () => {
  assert.equal(bodyColor(7), bodyColor(7, 3));
  assert.match(bodyColor(1), /^#[0-9a-f]{6}$/);
});
