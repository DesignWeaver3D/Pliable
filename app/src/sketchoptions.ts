/** Sketch preferences kept on this computer and their defaults. No DOM except localStorage (guarded). Moved out of sketch.ts, which re-exports it. */

/** Sketch preferences kept on this computer: the grid and which constraints the drawing tools add on their own. */
export interface SketchOptions {
  grid: boolean;
  /** Pointer positions snap to the grid while drawing. */
  snapGrid: boolean;
  /** Spacing of the bold grid lines, in the length unit (mm). */
  major: number;
  /** Spacing of the light lines between them, in the length unit; 0 draws none. The pointer snaps to this when it is set, else to the major spacing. */
  minor: number;
  /** Number of sides the Polygon tool draws. */
  sides: number;
  /** How much the grid fades toward the edges of the view (always measured from the middle of the view, so panning never hides the grid where you look). */
  fade: "off" | "subtle" | "strong";
  /** none: tools add no constraints; snaps: only those a snap implies (horizontal, vertical, on a curve, tangent); shape: also the ones that keep a rectangle, polygon or slot its shape. */
  auto: "none" | "snaps" | "shape";
}
export const OPTIONS_KEY = "pliable.sketchOptions2";

export function loadSketchOptions(): SketchOptions {
  const options: SketchOptions = { grid: false, snapGrid: false, major: 10, minor: 2, fade: "subtle", sides: 6, auto: "shape" };
  try {
    const saved = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? "null");
    if (saved) {
      options.grid = saved.grid === true;
      options.snapGrid = saved.snapGrid === true;
      if (Number.isFinite(saved.major) && saved.major > 0) options.major = saved.major;
      if (Number.isFinite(saved.minor) && saved.minor >= 0) options.minor = saved.minor;
      if (["none", "snaps", "shape"].includes(saved.auto)) options.auto = saved.auto;
      if (["off", "subtle", "strong"].includes(saved.fade)) options.fade = saved.fade;
      if (Number.isInteger(saved.sides) && saved.sides >= 3 && saved.sides <= 64) options.sides = saved.sides;
    }
  } catch {
    // no saved options (or storage is blocked): the defaults stand
  }
  return options;
}
