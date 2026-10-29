/** The colors of the two push/pull arrows (pure, so tests can load it). */
import { COLOR } from "./handlemath.ts";
import { AXIS_COLORS } from "./axes.ts";
import { arrowRoles } from "./pushpullstate.ts";

/** The color of the subtract arrow: the red of the x axis and the errors, not a new palette. */
export const SUBTRACT_COLOR: number = AXIS_COLORS.x;
export const ADD_COLOR: number = COLOR;

/** The colors of the arrow on the face-normal side and of the mirrored one on the other side. */
export function arrowColors(flip: boolean): { normalSide: number; oppositeSide: number } {
  const roles = arrowRoles(flip);
  const colour = (role: "add" | "subtract") => (role === "add" ? ADD_COLOR : SUBTRACT_COLOR);
  return { normalSide: colour(roles.normalSide), oppositeSide: colour(roles.oppositeSide) };
}
