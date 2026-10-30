/** The Hole Editor's one form (the core's Hole features tool): which fields show for the features switched on, what the switches do to
 *  each other, and the fastener presets that fill the size, the counterbore, the countersink and the thread together. Pure logic (no
 *  page), so a floating card or a docked panel can use it. */
import { FASTENERS, type HolePreset } from "./holepresets.ts";

export const FEATURES_TOOL = "hole_features";

/** What the picture shows: the end (0 opening, 1 far end) of a counterbore and of a countersink, or null when off, and whether it is threaded. */
export interface HoleFeatures {
  bore: 0 | 1 | null;
  sink: 0 | 1 | null;
  thread: boolean;
}

export type FeatureValues = Record<string, number | unknown>;

const num = (values: FeatureValues, name: string): number => Number(values[name] ?? 0);

/** The features the form's values switch on. */
export function featuresOf(values: FeatureValues): HoleFeatures {
  return {
    bore: num(values, "counterbore") >= 0.5 ? (num(values, "bore_end") >= 0.5 ? 1 : 0) : null,
    sink: num(values, "countersink") >= 0.5 ? (num(values, "sink_end") >= 0.5 ? 1 : 0) : null,
    thread: num(values, "thread") >= 0.5,
  };
}

/** Values to change after the field `changed` was changed. A new blind hole has no far end, so its features go back to the opening. A counterbore
 *  and a countersink cannot share an end, so the one switched on or moved last replaces the other (it is switched off, nothing is refused). */
export function resolveEnds(changed: string, values: FeatureValues, kind: "new" | "hole"): Record<string, number> {
  const out: Record<string, number> = {};
  const merged: FeatureValues = { ...values };
  if (kind === "new" && num(values, "depth") > 0)
    for (const end of ["bore_end", "sink_end"]) if (num(values, end) >= 0.5) merged[end] = out[end] = 0;
  const { bore, sink } = featuresOf(merged);
  if (bore !== null && sink !== null && bore === sink) out[changed === "counterbore" || changed === "bore_end" ? "countersink" : "counterbore"] = 0;
  return out;
}

/** The fields not shown: those of a feature switched off, those of the other kind of hole (a new hole is placed by its offsets, an existing one
 *  by its start and moves), the pitch unless the thread size is Custom, and the end of a feature when a new hole is blind (it has no far end). */
export function hiddenFields(kind: "new" | "hole", values: FeatureValues): string[] {
  const hidden: string[] = kind === "new" ? ["start", "dx", "dy", "dz"] : ["offset_u", "offset_v"];
  const { bore, sink, thread } = featuresOf(values);
  if (bore === null) hidden.push("bore_by", "bore_diameter", "bore_offset", "bore_depth", "bore_end");
  else hidden.push(num(values, "bore_by") >= 0.5 ? "bore_diameter" : "bore_offset");
  if (sink === null) hidden.push("sink_by", "sink_diameter", "sink_offset", "sink_angle", "sink_end");
  else hidden.push(num(values, "sink_by") >= 0.5 ? "sink_diameter" : "sink_offset");
  if (!thread) hidden.push("thread_size", "thread_pitch", "thread_hand");
  else if (num(values, "thread_size") >= 0.5) hidden.push("thread_pitch");
  if (kind === "new" && num(values, "depth") > 0) hidden.push("bore_end", "sink_end");
  return hidden;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** One list of fastener sizes. Choosing one sets the hole diameter (a clearance class or the tap drill), the thread size and pitch, and the
 *  counterbore and countersink dimensions together; it switches no feature on or off. `threadNames` are the standard sizes of the thread list. */
export function featurePresets(threadNames: string[]): HolePreset[] {
  return FASTENERS.flatMap((f) => {
    const index = threadNames.indexOf(f.name) + 1; // 0 = Custom (uses the pitch)
    const shared: Record<string, number> = {
      thread_size: index,
      thread_pitch: f.pitch,
      ...(f.counterbore ? { bore_by: 0, bore_diameter: f.counterbore.diameter, bore_depth: f.counterbore.depth } : {}),
      ...(f.countersink ? { sink_by: 0, sink_diameter: f.countersink.diameter, sink_angle: f.countersink.angle } : {}),
    };
    return [
      ...f.clearance.map((c) => ({ label: `${f.name} clearance, ${c.label} (${round3(c.diameter)})`, system: f.system, values: { diameter: c.diameter, ...shared } })),
      { label: `${f.name} tap drill (${round3(f.tap)})`, system: f.system, values: { diameter: f.tap, ...shared } },
    ];
  });
}

