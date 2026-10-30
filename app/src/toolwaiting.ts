/** A tool chosen before its selection exists: it waits (armed) and starts as soon as the selection fits, as if it had been preselected. */
import { describeNeeds, type ToolInfo } from "./tools.ts";

/** The status line for a tool that is waiting for a selection, in the style of the armed tool's "drag the selection". */
export function waitingHint(tool: ToolInfo): string {
  return `${tool.label}: select ${describeNeeds(tool)} to use it`;
}

/** The one tool waiting for a selection (choosing another tool, or the tool starting, ends the wait). */
export function createWaitingTool() {
  let waiting: ToolInfo | null = null;
  return {
    wait(tool: ToolInfo) {
      waiting = tool;
    },
    cancel() {
      waiting = null;
    },
    get tool(): ToolInfo | null {
      return waiting;
    },
    /** The waiting tool when `fits` now accepts the selection (the wait then ends), else null. */
    take(fits: (tool: ToolInfo) => boolean): ToolInfo | null {
      if (!waiting || !fits(waiting)) return null;
      const tool = waiting;
      waiting = null;
      return tool;
    },
  };
}
