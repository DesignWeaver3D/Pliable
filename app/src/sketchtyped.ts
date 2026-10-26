/** Typed sizes while a sketch shape is being drawn: which numbers each drawing tool takes, how keys edit the typed text
 *  (Tab or space moves to the next number), and where the typed numbers put the next points. No DOM. */
import type { Tool } from "./sketch.ts";
import type { UV } from "./sketchshapes.ts";

/** The numbers the tool takes at this stage of drawing (`chainLength` points placed so far), as short names; empty when the tool takes none. */
export function typedLabels(tool: Tool, chainLength: number, polygon: boolean): string[] {
  const first = chainLength === 1;
  const second = chainLength === 2;
  if (tool === "line") return chainLength >= 1 ? ["length"] : [];
  if (tool === "circle") return first ? ["diameter"] : [];
  if (polygon) return first ? ["radius"] : [];
  if (tool === "rectangle" || tool === "rectcentre") return first ? ["width", "height"] : [];
  if (tool === "slot") return first ? ["length", "width"] : second ? ["width"] : [];
  if (tool === "ellipse") return first ? ["major width", "minor width"] : second ? ["minor width"] : [];
  if (tool === "ellarc") return first ? ["major width", "minor width", "sweep degrees"] : second ? ["minor width", "sweep degrees"] : chainLength >= 3 ? ["sweep degrees"] : [];
  if (tool === "arc") return first ? ["radius", "sweep degrees"] : second ? ["sweep degrees"] : [];
  return [];
}

/** One key of typed entry: the new text, or null when the key is not part of entry. Tab and space start the next number. */
export function typedKey(text: string, key: string, fields: number): string | null {
  if (/^[0-9]$/.test(key)) return text + key;
  if (key === "." || key === ",") return text + ".";
  if (key === " " || key === "Tab") {
    if (!text) return null;
    if (fields > 1 && text.trim().split(/\s+/).length < fields && !text.endsWith(" ")) return text + " ";
    return key === "Tab" ? text : null; // Tab never leaves the entry while one is open
  }
  if (key === "Backspace" && text) return text.slice(0, -1);
  if (key === "Escape" && text) return "";
  return null;
}

/** The text shown next to the pointer while numbers are typed: every number the shape takes with its name, the one being typed marked with a caret
 *  ("Width 25|  Height", then "Width 25  Height 10|"). Without names (a tool that takes none) just the text. */
export function typedTag(labels: string[], text: string): string {
  if (!labels.length) return `${text}|`;
  const values = text.trim() ? text.trim().split(/\s+/) : [];
  const active = Math.min(labels.length - 1, Math.max(0, values.length - (text.endsWith(" ") ? 0 : 1)));
  return labels.map((label, i) => `${label[0].toUpperCase()}${label.slice(1)} ${values[i] ?? ""}${i === active ? "|" : ""}`.trimEnd()).join("   ");
}

/** The typed numbers, or null when any is not a positive number. */
export function parseTyped(text: string): number[] | null {
  const numbers = text.trim().split(/\s+/).map(Number);
  return numbers.every((n) => Number.isFinite(n) && n > 0) ? numbers : null;
}

/** Where the typed numbers put the next points, in the order they are placed. The pointer only chooses the direction. */
export function typedTargets(tool: Tool, chain: UV[], cursor: UV | null, numbers: number[]): UV[] {
  const first = chain[0];
  const last = chain[chain.length - 1];
  const toward = cursor ?? { u: last.u + 1, v: last.v };
  const [du, dv] = [toward.u - last.u, toward.v - last.v];
  const length = Math.hypot(du, dv) || 1;
  const along = (from: UV, distance: number): UV => ({ u: from.u + (du / length) * distance, v: from.v + (dv / length) * distance });
  // A point `distance` off the line a-b, on the side the pointer is on.
  const beside = (a: UV, b: UV, distance: number): UV => {
    const run = Math.hypot(b.u - a.u, b.v - a.v) || 1;
    const [nu, nv] = [-(b.v - a.v) / run, (b.u - a.u) / run];
    const sign = (toward.u - a.u) * nu + (toward.v - a.v) * nv < 0 ? -1 : 1;
    return { u: a.u + nu * sign * distance, v: a.v + nv * sign * distance };
  };
  const turned = (centre: UV, from: UV, degrees: number): UV => {
    const radius = Math.hypot(from.u - centre.u, from.v - centre.v);
    const angle = Math.atan2(from.v - centre.v, from.u - centre.u) + (degrees * Math.PI) / 180;
    return { u: centre.u + radius * Math.cos(angle), v: centre.v + radius * Math.sin(angle) };
  };
  const [w, h] = [numbers[0], numbers[1]];
  if (tool === "rectangle" || tool === "rectcentre") {
    const k = tool === "rectcentre" ? 2 : 1;
    return [{ u: first.u + (toward.u - first.u < 0 ? -w : w) / k, v: first.v + (toward.v - first.v < 0 ? -(h ?? w) : h ?? w) / k }];
  }
  if (tool === "slot") {
    if (chain.length === 2) return [beside(chain[0], chain[1], w / 2)];
    const end = along(first, w);
    return h === undefined ? [end] : [end, beside(first, end, h / 2)];
  }
  if (tool === "ellipse") {
    if (chain.length === 2) return [beside(chain[0], chain[1], w / 2)]; // the typed numbers are the full widths of the axes
    const end = along(first, w / 2);
    return h === undefined ? [end] : [end, beside(first, end, h / 2)];
  }
  if (tool === "ellarc") {
    // The arc starts at the end of the long axis and sweeps the typed degrees counterclockwise, measured about the centre.
    const sweep = numbers[numbers.length - 1];
    if (chain.length === 4) return [turned(first, chain[3], sweep)];
    const major = chain.length === 1 ? along(first, w / 2) : chain[1];
    if (chain.length === 3) return [major, turned(first, major, sweep)];
    const widths = chain.length === 1 ? 2 : 1; // the numbers before the sweep
    const out: UV[] = chain.length === 1 ? [major] : [];
    if (numbers.length < widths) return out;
    out.push(beside(first, major, numbers[widths - 1] / 2));
    if (numbers.length > widths) out.push(major, turned(first, major, numbers[widths]));
    return out;
  }
  if (tool === "arc") {
    if (chain.length === 2) return [turned(first, chain[1], w)];
    const start = along(first, w);
    return h === undefined ? [start] : [start, turned(first, start, h)];
  }
  if (tool === "circle") return [along(last, w / 2)]; // the typed number is the diameter
  return [along(last, w)];
}
