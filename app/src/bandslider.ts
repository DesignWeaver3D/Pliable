/** The Stretch band length slider: its parameter is 0 for "Auto", and the handle shows the length in use (`rest` when Auto).
 *  A drag starts from that shown length, sets the parameter to the dragged length, and lands on Auto (0) near `rest`. */
import type { HandleInfo } from "./tools.ts";
import { handleValue } from "./handlemath.ts";
import { roundValue } from "./precision.ts";

/** A dragged length within this fraction of the Auto length counts as Auto. */
export const AUTO_SNAP_FRACTION = 0.05;

export function isBandSlider(info: Pick<HandleInfo, "rest">): boolean {
  return info.rest != null;
}

/** Whether a band length counts as the Auto length. */
export function isAutoLength(length: number, rest: number): boolean {
  return Math.abs(length - rest) <= Math.max(rest * AUTO_SNAP_FRACTION, 1e-9);
}

/** The parameter a dragged band length stands for: 0 (Auto) near `rest`, else the length itself. */
export function bandParam(length: number, rest: number): number {
  return isAutoLength(length, rest) ? 0 : length;
}

/** The parameter value a drag of `info` to `travel` sends: the ordinary rounded value, or the band's Auto-aware one. */
export function dragParam(info: Pick<HandleInfo, "value" | "scale" | "min" | "max" | "rest">, travel: number): number {
  const value = handleValue(info, travel);
  return roundValue(info.rest != null ? bandParam(value, info.rest) : value);
}

/** The label text of a band slider at `length`: "Auto" or the length. */
export function bandLabel(length: number, rest: number, format: (v: number) => string): string {
  return isAutoLength(length, rest) ? "Auto" : format(length);
}
