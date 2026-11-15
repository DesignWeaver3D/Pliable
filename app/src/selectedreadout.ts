/** The names of the selected objects, shown in the header of the parameters panel. */
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

export interface SelectedItem {
  kind: string;
  id: number;
}

/** What the readout needs to know about the model: a body's name, and which body owns a face, edge or vertex. */
export interface NameLookups {
  bodyName(id: number): string | undefined;
  owner(kind: "face" | "edge" | "vertex", id: number): number | null | undefined;
}

/** The most items of one group listed by name in the short text; more than this are counted instead. */
const LISTED = 3;

/** What is selected, named: bodies by name, faces, edges and vertices as "body: face 12, face 14" (counted past a few, with the whole list in `full`).
 *  `text` is for the readout, `full` for its tooltip. A global axis is added as "X axis". */
export function describeSelection(sels: readonly SelectedItem[], look: NameLookups): { text: string; full: string } {
  if (sels.length === 0) return { text: "", full: "" };
  const axes = sels.filter((s) => s.kind === "axis").map((s) => `${"XYZ"[s.id]} axis`);
  const bodies = sels.filter((s) => s.kind === "body").map((s) => look.bodyName(s.id) ?? `body ${s.id}`);
  const groups = new Map<string, string[]>(); // owning body's name ("" when it has none) -> "face 12", "edge 3" ...
  for (const s of sels) {
    if (s.kind !== "face" && s.kind !== "edge" && s.kind !== "vertex") continue;
    const id = look.owner(s.kind, s.id);
    const name = id == null ? "" : (look.bodyName(id) ?? `body ${id}`);
    groups.set(name, [...(groups.get(name) ?? []), `${s.kind} ${s.id}`]);
  }
  const short: string[] = [];
  const full: string[] = [];
  if (bodies.length) {
    full.push(bodies.join(", "));
    short.push(bodies.length <= LISTED ? bodies.join(", ") : `${bodies.slice(0, LISTED).join(", ")} +${bodies.length - LISTED} more`);
  }
  for (const [name, items] of groups) {
    const prefix = name ? `${name}: ` : "";
    full.push(prefix + items.join(", "));
    if (items.length <= LISTED) short.push(prefix + items.join(", "));
    else {
      const kinds = new Set(items.map((i) => i.split(" ")[0]));
      short.push(`${prefix}${items.length} ${kinds.size === 1 ? `${[...kinds][0]}s` : "items"}`);
    }
  }
  if (axes.length) {
    full.push(axes.join(", "));
    short.push(axes.join(", "));
  }
  return { text: short.join("; "), full: full.join("; ") };
}
