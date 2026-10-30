/** A thread chosen for a new hole in the Hole Editor card: after the hole is applied, Thread hole runs on its bore and joins the same undo step. */
import type { Sel } from "./viewport";
import type { ToolInfo } from "./tools.ts";

/** The tools that make a new hole; a thread chosen with one of them is cut right after it. */
export const NEW_HOLE_TOOLS = ["add_hole", "add_counterbore", "add_countersink"];

/** `size` is the index in Thread hole's size list (0 is Custom, so a chosen thread is 1 or more); 0 means no thread. */
export interface HoleThread {
  size: number;
  left: boolean;
}

export const NO_THREAD: HoleThread = { size: 0, left: false };

/** The labels of Thread hole's standard sizes (Custom left out), in the core's order, for the card's thread list. */
export function threadSizeNames(tools: ToolInfo[]): string[] {
  const options = tools.find((t) => t.id === "thread_hole")?.params.find((p) => p.name === "size")?.options ?? [];
  return options.slice(1);
}

/** The Thread hole values for the chosen thread: the standard pitch of the size, the whole bore, the standard depth. */
export function threadValues(thread: HoleThread): Record<string, number> {
  return { size: thread.size, pitch: 1.25, depth: 0, length: 0, hand: thread.left ? 1 : 0 };
}

/** The request that threads the bore a new-hole commit left selected (`kept`), folded into the hole's undo step; null when no thread is chosen or no single face was kept. */
export function threadRequest(toolId: string, thread: HoleThread, kept: Sel[], payload: (sels: Sel[]) => object): Record<string, unknown> | null {
  if (!NEW_HOLE_TOOLS.includes(toolId) || thread.size < 1 || kept.length !== 1 || kept[0].kind !== "face") return null;
  return { tool: "thread_hole", selection: payload(kept), params: threadValues(thread), foldPick: true };
}
