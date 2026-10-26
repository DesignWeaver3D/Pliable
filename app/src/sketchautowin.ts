/** A constraint the user adds beats one a drawing tool added (owner, 2026-10-26): when the new one makes the sketch fail, the automatic
 *  constraints named in the blame are the ones to try removing, never the user's own. */
import type { SketchConstraint } from "./sketchmodel.ts";

/** The automatic constraints among the blamed ones (not counting what was just added), in list order. */
export function automaticInTheWay(constraints: readonly SketchConstraint[], blamed: ReadonlySet<number>, added: ReadonlySet<number>): SketchConstraint[] {
  return constraints.filter((c) => c.auto && blamed.has(c.id) && !added.has(c.id));
}
