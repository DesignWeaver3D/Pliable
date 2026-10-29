/** Standard hole sizes offered as a preset list beside a hole form's diameter fields: metric clearance and tap drill
 *  diameters (coarse thread) and the counterbore diameters for socket head cap screws. Values are millimeters. */
export interface HoleSize {
  label: string;
  diameter: number;
}

const SCREWS: [string, number, number, number | null][] = [
  // size, medium clearance, coarse tap drill, counterbore for a socket head cap screw
  ["M2", 2.4, 1.6, null],
  ["M2.5", 2.9, 2.05, null],
  ["M3", 3.4, 2.5, 6.5],
  ["M4", 4.5, 3.3, 8],
  ["M5", 5.5, 4.2, 10],
  ["M6", 6.6, 5, 11],
  ["M8", 9, 6.8, 15],
  ["M10", 11, 8.5, 18],
  ["M12", 13.5, 10.2, 20],
  ["M14", 15.5, 12, 23],
  ["M16", 17.5, 14, 26],
  ["M20", 22, 17.5, 33],
];

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
