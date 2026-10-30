/** The standard thread sizes of the Hole Editor's thread list. */
import type { ToolInfo } from "./tools.ts";

/** The labels of Thread hole's standard sizes (Custom left out), in the core's order, for the card's presets. */
export function threadSizeNames(tools: ToolInfo[]): string[] {
  const options = tools.find((t) => t.id === "hole_features")?.params.find((p) => p.name === "thread_size")?.options ?? [];
  return options.slice(1);
}
