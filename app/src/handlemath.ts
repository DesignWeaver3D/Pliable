/** The maths and constants of the on-screen manipulators that need no camera or scene: pick scores, handle colours, value
 *  and typed-entry arithmetic, and the turn arc and ring helpers. Moved out of manipulator.ts unchanged (that file re-exports
 *  all of it); exported for tests (`node --test app/tests`). */
import * as THREE from "three";
import { AXIS_COLORS } from "./axes.ts";
import type { HandleInfo } from "./tools";

/** Length of a handle's arm and the radius of its grab target, in screen pixels. */
export const ARM_PX = 34;
export const GRAB_PX = 9;
/** A move arrow is this long on screen, from its anchor to the arrowhead, whatever the size of the object. */
export const MOVE_ARM_PX = 80;
export const COLOR = 0xffb347;
export const COLOR_HOT = 0xffffff;
export const COLOR_TOGGLE = 0x6fd3ff;
/** The line a hole's axis handle draws from its opening to its far grip. */
export const AXIS_LINE = 0xffb347;
export const HANDLE_OUTLINE = 0x1b1d22; // the dark outline under grips, as under the dimension lines
/** Resize grips are neutral squares (orange on hover) so they never read as the coloured move arrows. */
export const COLOR_RESIZE = 0xc8ccd4;
export const COLOR_RESIZE_HOT = 0xffb347;

/** How close a handle counts for picking: its pixel distance, lowered when it should win a tie. `t` is the position
 *  along the handle from its tail (the anchor of a resize grip, the start of a move arrow) to its head (0..1). The head
 *  half of a move arrow beats a resize grip under the same pixel; the tail of a move arrow, where it starts on the
 *  object's origin, does not, so the grip stays reachable; a pull handle's tip wins over its own arm. */
export function pickScore(distPx: number, kind: string | undefined, t: number): number {
  if (kind === "move") return t >= 0.5 ? distPx - 6 : distPx;
  return t === 0 ? distPx - 2 : distPx;
}

/** Where along a handle (0 at its tail, 1 at its head) the grabbable end shape sits, or null when the whole arm can be
 *  grabbed. A resize grip is grabbed by its cube and a move arrow by its arrowhead, never by the line between them. */
export function grabFraction(kind: string | undefined, toggle: boolean | undefined): number | null {
  if (toggle) return null;
  if (kind === "resize") return 0;
  if (kind === "move") return (MOVE_ARM_PX / ARM_PX - 0.21) / (MOVE_ARM_PX / ARM_PX);
  return null;
}

/** The origin-axis colour of a direction (its largest component), or white-ish for none. */
export function axisColorOf(d: readonly number[]): number {
  const a = d.map(Math.abs);
  const k = a.indexOf(Math.max(...a));
  return [AXIS_COLORS.x, AXIS_COLORS.y, AXIS_COLORS.z][k];
}

/** The look of a handle: its resting and hover colour. */
export function handleColors(info: Pick<HandleInfo, "kind" | "toggle" | "direction"> & { axis?: readonly number[] | null }): { rest: number; hot: number } {
  if (info.toggle || info.kind === "toggle") return { rest: COLOR_TOGGLE, hot: COLOR_HOT };
  if (info.axis) return { rest: axisColorOf(info.axis), hot: COLOR_HOT }; // a rotation handle wears the colour of its axis
  if (info.kind === "move") return { rest: axisColorOf(info.direction), hot: COLOR_HOT };
  if (info.kind === "resize") return { rest: COLOR_RESIZE, hot: COLOR_RESIZE_HOT };
  return { rest: COLOR, hot: COLOR_HOT };
}

/** The parameter value a handle shows after travelling `travel` (model units along the handle line). */
export function handleValue(h: Pick<HandleInfo, "value" | "scale" | "min"> & { max?: number | null }, travel: number): number {
  const v = h.value + h.scale * travel;
  if (h.min !== null && v < h.min) return h.min;
  if (h.max != null && v > h.max) return h.max;
  return v;
}

/** How close (degrees) a turn ring's drag must pass to a snap angle to land on it. */
export const SNAP_DEGREES = 3;

/** The value a turn ring drag lands on: the nearest of the handle's snap angles within SNAP_DEGREES (angles repeat every 360), else the value itself. */
export function snapValue(value: number, snaps: readonly number[] | undefined): number {
  let best = value;
  let bestD = SNAP_DEGREES;
  for (const snap of snaps ?? []) {
    const target = snap + 360 * Math.round((value - snap) / 360);
    if (Math.abs(target - value) < bestD) {
      bestD = Math.abs(target - value);
      best = target;
    }
  }
  return best;
}

/** The values of a handle's linked parameters after travelling `travel`. */
export function linkedValues(h: Pick<HandleInfo, "links">, travel: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of h.links ?? []) out[l.param] = Math.round((l.value + l.scale * travel) * 1000) / 1000;
  return out;
}

/** The travel that gives `value` (inverse of handleValue; used to keep the handle where the clamp put it). */
export function travelFor(h: Pick<HandleInfo, "value" | "scale">, value: number): number {
  return h.scale === 0 ? 0 : (value - h.value) / h.scale;
}

/** The handle travel that a typed number asks for, or null while nothing usable is typed. A move arrow's number is the
 *  distance along its axis (negative goes backwards); any other handle's number is the parameter value itself (the size
 *  of a resize grip, a radius), with the handle's direction kept and the declared limits applied. */
export function typedTravel(h: Pick<HandleInfo, "value" | "scale" | "min" | "kind"> & { factor?: number } & { max?: number | null }, text: string, negative: boolean): number | null {
  const n = text === "" || text === "." ? NaN : Number(text);
  if (!Number.isFinite(n)) return null;
  const signed = negative ? -n : n;
  const raw = h.kind === "move" ? signed : travelFor(h, signed / (h.factor || 1));
  return travelFor(h, handleValue(h, raw));
}

/** One key of typed entry: the new text and sign, or null when the key is not part of entry. A second "-" flips the sign back. */
export function typedStep(text: string | null, negative: boolean, key: string): { text: string; negative: boolean } | null {
  if (key === "-") return { text: text ?? "", negative: !negative };
  if (/^[0-9]$/.test(key)) return { text: (text ?? "") + key, negative };
  if (key === "." && !(text ?? "").includes(".")) return { text: (text ?? "") + ".", negative };
  if (key === "Backspace" && text !== null) return { text: text.slice(0, -1), negative };
  return null;
}

/** Where along the line (point p, unit direction d) the pointer ray passes closest, as a distance from p; null when the
 *  ray is nearly parallel to the line (looking along it), where the position is not defined. */
export function lineParam(p: THREE.Vector3, d: THREE.Vector3, rayOrigin: THREE.Vector3, rayDir: THREE.Vector3): number | null {
  const w = p.clone().sub(rayOrigin);
  const b = d.dot(rayDir);
  const denom = 1 - b * b;
  if (denom < 1e-4) return null;
  return (b * rayDir.dot(w) - d.dot(w)) / denom;
}

/** A value for a label: at most three decimals, no trailing zeros. */
export function formatValue(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}

/** A turn arc (see HandleInfo.arc) runs this many pixels from its centre, 120 degrees of it, beyond the move arrows' tips. */
export const ARC_RADIUS_PX = 110;
export const ARC_HALF_SPAN = Math.PI / 3;
export const ARC_STEPS = 24;
export const ARC_REST_OPACITY = 0.9;
/** A turn arc whose value is this close (degrees) to a snap angle counts as sitting on it; it is drawn in this colour then. */
export const SNAPPED_DEGREES = 0.5;
export const COLOR_SNAPPED = 0x6be36b;

/** The index of the snap angle (degrees, repeating every 360) that `value` sits on, or -1. */
export function snappedIndex(value: number, snaps: readonly number[] | undefined): number {
  return (snaps ?? []).findIndex((snap) => Math.abs(value - snap - 360 * Math.round((value - snap) / 360)) < SNAPPED_DEGREES);
}

/** A rotation ring's diameter is this fraction of the shortest side of the 3D view, so it never runs off screen. */
export const RING_VIEW_FRACTION = 0.5;

/** A rotation handle moved onto a ring of another radius about the same centre: its grip keeps its angle round the ring,
 *  and its degrees per unit of travel follow the new radius. `ring` is [cx, cy, cz, radius]. */
export function refitRing(
  ring: readonly number[],
  anchor: readonly number[],
  scale: number,
  radius: number,
): { ring: number[]; anchor: number[]; scale: number } {
  const k = radius / ring[3];
  return {
    ring: [ring[0], ring[1], ring[2], radius],
    anchor: [0, 1, 2].map((i) => ring[i] + (anchor[i] - ring[i]) * k),
    scale: scale / k,
  };
}
