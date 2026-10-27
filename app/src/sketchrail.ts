/** A kept sketch chosen in the view as the path of Sweep face along edge and Array along path (it stands in for the edges they otherwise need). */
import { acceptsSelection, type ToolInfo } from "./tools.ts";
import type { Sel } from "./viewport.ts";

/** Whether the tool takes the selection when a sketch is chosen as its path: only tools that declare `railAccepts`, and with edges only when its `railAccepts` allows them (Revolve face takes an edge or axis for the axis). */
export function acceptsWithRail(tool: ToolInfo, sels: Sel[], chosen: number | null): boolean {
  if (chosen === null || !tool.railAccepts) return false;
  return acceptsSelection({ ...tool, accepts: tool.railAccepts }, sels);
}
