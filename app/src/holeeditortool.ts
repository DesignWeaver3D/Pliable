/** The one "Hole Editor" entry of the tool drawer and the command search. It has no tool in the core: choosing it opens the Hole Editor card on
 *  the selection (a hole to edit, or a flat face for a new hole) and, with nothing fitting selected, waits for one like any drawer tool. */
import type { ToolInfo } from "./tools.ts";

export const HOLE_EDITOR_ID = "hole_editor";

export function holeEditorTool(): ToolInfo {
  return {
    id: HOLE_EDITOR_ID,
    label: "Hole Editor",
    description: "Makes a round hole in a flat face or changes an existing hole: size, depth, counterbore, countersink, thread, fill and position, with metric and inch fastener presets. Select a flat face for a new hole, or a hole to edit it.",
    accepts: { faces: [1, null], edges: [1, 1], anyOf: true },
    params: [],
    startsFrom: "selection",
    hasHandles: false,
  };
}
