/** The Join button: the selected curves that connect end to end become one curve (the geometry is in sketchjoincurves.ts). */
import { joinCurves } from "./sketchjoincurves.ts";
import { applyEdit } from "./sketchtransform.ts";
import type { SketchMode } from "./sketch.ts";

export async function joinSelection(mode: SketchMode) {
  const ids = mode.selection.filter((x) => x.kind === "entity").map((x) => x.id);
  const made = joinCurves(mode.s, ids);
  if (typeof made === "string") return mode.host.status(made, true);
  await applyEdit(mode, () => ({ sketch: made, selection: [{ kind: "entity", id: ids[0] }] }));
  mode.host.status(`Joined ${ids.length} curves into one`);
}
