/** Standard hole sizes offered as a preset list beside a hole form's diameter fields: metric clearance and tap drill
 *  diameters (coarse thread) and the counterbore diameters for socket head cap screws. Values are millimeters. */
import { defaultClearance, fastenersOf } from "./holepresets.ts";

export interface HoleSize {
  label: string;
  diameter: number;
}

// size, medium clearance, coarse tap drill, counterbore for a socket head cap screw (M24 is only in the Hole Editor's table)
const SCREWS: [string, number, number, number | null][] = fastenersOf("metric")
  .filter((f) => f.name !== "M24")
  .map((f) => [f.name, defaultClearance(f).diameter, f.tap, f.counterbore?.diameter ?? null]);


/** The hole tools that take a diameter and the parameter each preset list fills. */
export const SIZE_PARAMS: Record<string, string[]> = {
  add_hole: ["diameter"],
  add_counterbore: ["diameter", "bore_diameter"],
  add_countersink: ["diameter"],
  resize_hole: ["diameter"],
  edit_hole: ["diameter"],
  convert_to_counterbore: ["bore_diameter"],
};

/** Presets for one parameter: bore diameters for `bore_diameter`, else clearance holes followed by tap drills. */
export function holeSizes(param: string): HoleSize[] {
  if (param === "bore_diameter") return SCREWS.filter((s) => s[3] !== null).map((s) => ({ label: `${s[0]} cap screw counterbore`, diameter: s[3] as number }));
  return [...SCREWS.map((s) => ({ label: `${s[0]} clearance`, diameter: s[1] })), ...SCREWS.map((s) => ({ label: `${s[0]} tap drill`, diameter: s[2] }))];
}

/** The countersink head angles offered most often, with where each is the standard (the full included angle, in degrees). */
export const COUNTERSINK_ANGLES: readonly { angle: number; label: string }[] = [
  { angle: 82, label: "82° (inch screws)" },
  { angle: 90, label: "90° (metric screws)" },
  { angle: 100, label: "100°" },
  { angle: 110, label: "110°" },
  { angle: 120, label: "120°" },
];

/** The countersink tools whose angle gets the list of standard head angles. */
export function hasAngles(toolId: string, param: string): boolean {
  return param === "sink_angle" && (toolId === "add_countersink" || toolId === "convert_to_countersink");
}

/** Whether a tool's parameter gets a preset list. */
export function hasSizes(toolId: string, param: string): boolean {
  return SIZE_PARAMS[toolId]?.includes(param) ?? false;
}
