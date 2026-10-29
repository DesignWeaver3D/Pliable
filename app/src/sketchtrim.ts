/** The Trim tool in two clicks (owner, 2026-10-25): the first click on a line cuts it at every crossing with other curves and turns the
 *  piece under the click into construction geometry (the candidate); a second click on that piece deletes it. The cutting is the
 *  split tool's (`splitLine`), so the pieces keep their direction constraints. */
import { crossings, pointOf, remove } from "./sketchmodel.ts";
import type { SketchData } from "./sketchmodel.ts";
import { splitLine } from "./sketchedit.ts";

export interface TrimResult {
  sketch: SketchData;
  /** Ids of lines marked as trim candidates; a click on one deletes it. */
  candidates: Set<number>;
}

export function trimClick(s: SketchData, lineId: number, u: number, v: number, candidates: ReadonlySet<number>): TrimResult | null {
  const line = s.entities.find((e) => e.id === lineId);
  if (!line || line.type !== "line" || line.reference) return null;
  if (candidates.has(lineId)) {
    const rest = new Set(candidates);
    rest.delete(lineId);
    return { sketch: remove(s, { kind: "entity", id: lineId }), candidates: rest };
  }
  const a = pointOf(s, line.a);
  const b = pointOf(s, line.b);
  const len2 = (b.u - a.u) ** 2 + (b.v - a.v) ** 2;
  if (len2 < 1e-12) return null;
  const at = (t: number): [number, number] => [a.u + t * (b.u - a.u), a.v + t * (b.v - a.v)];
  const click = ((u - a.u) * (b.u - a.u) + (v - a.v) * (b.v - a.v)) / len2;
  const cuts = [...new Set(crossings(s, line).filter((t) => t > 1e-6 && t < 1 - 1e-6).map((t) => Math.round(t * 1e9) / 1e9))].sort((x, y) => x - y);
  // Cut from the far end: the first piece keeps the line's id, and each cut adds the piece beyond it.
  let sketch = s;
  const beyond = new Map<number, number>(); // cut index -> id of the piece starting at that cut
  for (let i = cuts.length - 1; i >= 0; i--) {
    const made = splitLine(sketch, lineId, ...at(cuts[i]), 1e-6);
    if (!made) continue;
    sketch = made.sketch;
    beyond.set(i, (made.selection[1] as { id: number }).id);
  }
  // Cutting from the far end leaves collinear constraints between pieces that are not neighbors, which repeat the ones between them and make
  // the solver refuse the sketch; join each piece to the next one instead.
  const ordered = [lineId, ...cuts.map((_, i) => beyond.get(i)).filter((id): id is number => id !== undefined)];
  const old = new Set(s.constraints.map((c) => c.id));
  if (sketch.constraints.some((c) => c.type === "collinear" && !old.has(c.id))) {
    let id = Math.max(0, ...sketch.constraints.map((c) => c.id)) + 1;
    const kept = sketch.constraints.filter((c) => !(c.type === "collinear" && !old.has(c.id)));
    for (let i = 0; i + 1 < ordered.length; i++) kept.push({ id: id++, type: "collinear", entities: [ordered[i], ordered[i + 1]], auto: true });
    sketch = { ...sketch, constraints: kept };
  }
  let piece = lineId; // the piece under the click: after the last cut before it
  for (let i = 0; i < cuts.length; i++) if (beyond.has(i) && click >= cuts[i]) piece = beyond.get(i)!;
  sketch = { ...sketch, entities: sketch.entities.map((e) => (e.id === piece && e.type === "line" ? { ...e, construction: true } : e)) };
  return { sketch, candidates: new Set([...candidates, piece]) };
}
