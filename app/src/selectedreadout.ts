/** The names of the selected objects, printed bottom right, left of the parameters panel. */
import { entityOf, type SketchData, type SketchSel } from "./sketchmodel.ts";

const PLURALS: Record<string, string> = { line: "lines", circle: "circles", arc: "arcs", ellipse: "ellipses", spline: "splines", point: "points", axis: "axes" };

/** What is selected in a sketch, by kind and count: "2 lines, 1 point". */
export function sketchSelectionText(s: SketchData, sel: SketchSel[]): string {
  const counts = new Map<string, number>();
  for (const x of sel) {
    const kind = x.kind === "point" ? "point" : x.id < 0 ? "axis" : (entityOf(s, x.id)?.type ?? "curve");
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const text = [...counts].map(([kind, n]) => (n === 1 ? `1 ${kind}` : `${n} ${PLURALS[kind] ?? `${kind}s`}`)).join(", ");
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}
