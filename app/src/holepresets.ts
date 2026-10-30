/** Fastener hole presets for the Hole Editor card: metric and inch screw sizes with the hole sizes each needs. Data and lookups only
 *  (no view code), so the card, the Sizes lists of the hole forms and a later docked panel all read one table. Values are millimeters.
 *
 *  Where each number comes from:
 *  - Clearance holes, metric: fine, medium and coarse series of the clearance-hole standard (ISO 273). NOT VERIFIED against the standard text
 *    (it is paid; the web copies found were unreadable). Entered from the published series; listed in author-guidance.md.
 *  - Clearance holes, inch: close and normal fit drills, checked against a published inch counterbore chart (amesweb.info).
 *  - Tap drills: metric = the standard drill nearest major diameter minus the coarse pitch (a published rule: 6.75 is drilled as 6.8, 10.2 for M12); 1/2-13 checked (27/64). The other inch drills are the
 *    usual 75 percent thread drills and NOT VERIFIED.
 *  - Counterbores for socket head cap screws: depth = head height (the screw size for metric, the major diameter for inch; checked against
 *    a published chart); metric diameters are the common cap screw counterbore series (M3 and M6 checked); inch diameters checked.
 *  - Countersinks: metric 90 degree and inch 82 degree flat head diameters. NOT VERIFIED.
 */
export type FitSystem = "metric" | "inch";

export interface Clearance {
  /** Short name of the class (fine, medium and coarse for metric; close and normal for inch). */
  label: string;
  diameter: number;
}

export interface Fastener {
  /** The name shown, such as "M6" or "1/4-20". */
  name: string;
  system: FitSystem;
  /** The thread's major diameter and coarse pitch. */
  major: number;
  pitch: number;
  clearance: Clearance[];
  /** The tap drill diameter for the coarse thread. */
  tap: number;
  /** A socket head cap screw's counterbore diameter and depth, when the size has one. */
  counterbore: { diameter: number; depth: number } | null;
  /** The flat head countersink: the cone's diameter at the surface and its included angle. */
  countersink: { diameter: number; angle: number } | null;
}

const INCH = 25.4;
const mm = (inches: number) => Math.round(inches * INCH * 1000) / 1000;

// name, major, pitch, fine, medium, coarse, counterbore diameter, countersink diameter (90 degrees)
const METRIC: [string, number, number, number, number, number, number | null, number | null][] = [
  ["M2", 2, 0.4, 2.2, 2.4, 2.6, null, null],
  ["M2.5", 2.5, 0.45, 2.7, 2.9, 3.1, null, null],
  ["M3", 3, 0.5, 3.2, 3.4, 3.6, 6.5, 6.72],
  ["M4", 4, 0.7, 4.3, 4.5, 4.8, 8, 8.96],
  ["M5", 5, 0.8, 5.3, 5.5, 5.8, 10, 11.2],
  ["M6", 6, 1, 6.4, 6.6, 7, 11, 13.44],
  ["M8", 8, 1.25, 8.4, 9, 10, 15, 17.92],
  ["M10", 10, 1.5, 10.5, 11, 12, 18, 22.4],
  ["M12", 12, 1.75, 13, 13.5, 14.5, 20, 26.88],
  ["M14", 14, 2, 15, 15.5, 16.5, 23, 30.8],
  ["M16", 16, 2, 17, 17.5, 18.5, 26, 33.6],
  ["M20", 20, 2.5, 21, 22, 24, 33, 40.32],
  ["M24", 24, 3, 25, 26, 28, 40, null],
];

/** Coarse thread tap drills: the major diameter minus the pitch, rounded to the drill sizes in use. */
const METRIC_TAP: Record<string, number> = { M2: 1.6, "M2.5": 2.05, M3: 2.5, M4: 3.3, M5: 4.2, M6: 5, M8: 6.8, M10: 8.5, M12: 10.2, M14: 12, M16: 14, M20: 17.5, M24: 21 };

// name, major (inch), threads per inch, close, normal, tap drill, counterbore diameter, countersink diameter (82 degrees), all inches
const INCH_SIZES: [string, number, number, number, number, number, number, number | null][] = [
  ["#2-56", 0.086, 56, 0.094, 0.106, 0.07, 0.1875, 0.167],
  ["#4-40", 0.112, 40, 0.125, 0.136, 0.089, 0.21875, 0.225],
  ["#6-32", 0.138, 32, 0.154, 0.17, 0.1065, 0.28125, 0.279],
  ["#8-32", 0.164, 32, 0.18, 0.194, 0.136, 0.3125, 0.332],
  ["#10-24", 0.19, 24, 0.206, 0.221, 0.1495, 0.375, 0.385],
  ["#10-32", 0.19, 32, 0.206, 0.221, 0.159, 0.375, 0.385],
  ["1/4-20", 0.25, 20, 0.266, 0.281, 0.201, 0.4375, 0.507],
  ["5/16-18", 0.3125, 18, 0.328, 0.344, 0.257, 0.53125, 0.635],
  ["3/8-16", 0.375, 16, 0.391, 0.406, 0.3125, 0.625, 0.762],
  ["1/2-13", 0.5, 13, 0.516, 0.531, 0.4219, 0.8125, 1.012],
];

export const FASTENERS: readonly Fastener[] = [
  ...METRIC.map(([name, major, pitch, fine, medium, coarse, bore, sink]): Fastener => ({
    name,
    system: "metric",
    major,
    pitch,
    clearance: [
      { label: "fine", diameter: fine },
      { label: "medium", diameter: medium },
      { label: "coarse", diameter: coarse },
    ],
    tap: METRIC_TAP[name],
    counterbore: bore === null ? null : { diameter: bore, depth: major },
    countersink: sink === null ? null : { diameter: sink, angle: 90 },
  })),
  ...INCH_SIZES.map(([name, major, tpi, close, normal, tap, bore, sink]): Fastener => ({
    name,
    system: "inch",
    major: mm(major),
    pitch: Math.round((INCH / tpi) * 1000) / 1000,
    clearance: [
      { label: "close", diameter: mm(close) },
      { label: "normal", diameter: mm(normal) },
    ],
    tap: mm(tap),
    counterbore: { diameter: mm(bore), depth: mm(major) },
    countersink: sink === null ? null : { diameter: mm(sink), angle: 82 },
  })),
];

/** The fasteners of one system, or all of them. */
export function fastenersOf(system?: FitSystem): readonly Fastener[] {
  return system ? FASTENERS.filter((f) => f.system === system) : FASTENERS;
}

/** The fastener with this name, or undefined. */
export function fastenerNamed(name: string): Fastener | undefined {
  return FASTENERS.find((f) => f.name === name);
}

/** The clearance class used when none is chosen: medium for metric, normal for inch. */
export function defaultClearance(f: Fastener): Clearance {
  return f.clearance.find((c) => c.label === "medium" || c.label === "normal") ?? f.clearance[0];
}

/** One entry of a preset list: what to show and the form fields it fills. */
export interface HolePreset {
  label: string;
  system: FitSystem;
  values: Record<string, number>;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Hole diameters: every clearance class, then the tap drill, of each fastener. */
export function diameterPresets(): HolePreset[] {
  return FASTENERS.flatMap((f) => [
    ...f.clearance.map((c) => ({ label: `${f.name} clearance, ${c.label} (${round3(c.diameter)})`, system: f.system, values: { diameter: c.diameter } })),
    { label: `${f.name} tap drill (${round3(f.tap)})`, system: f.system, values: { diameter: f.tap } },
  ]);
}

/** Counterbores for socket head cap screws: the recess diameter and depth. */
export function counterborePresets(): HolePreset[] {
  return FASTENERS.filter((f) => f.counterbore).map((f) => ({ label: `${f.name} cap screw (${round3(f.counterbore!.diameter)} x ${round3(f.counterbore!.depth)})`, system: f.system, values: { bore_by: 0, bore_diameter: f.counterbore!.diameter, bore_depth: f.counterbore!.depth } }));
}

/** Thread pitches: the coarse pitch of each fastener, for the Thread section's pitch field (the size list is left on Custom). */
export function threadPresets(): HolePreset[] {
  return FASTENERS.map((f) => ({ label: `${f.name} thread, pitch ${round3(f.pitch)}`, system: f.system, values: { size: 0, pitch: f.pitch } }));
}

/** Countersinks for flat head screws: the cone's diameter at the surface and its included angle. */
export function countersinkPresets(): HolePreset[] {
  return FASTENERS.filter((f) => f.countersink).map((f) => ({ label: `${f.name} flat head (${round3(f.countersink!.diameter)}, ${f.countersink!.angle}°)`, system: f.system, values: { sink_by: 0, sink_diameter: f.countersink!.diameter, sink_angle: f.countersink!.angle } }));
}
