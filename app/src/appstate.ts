/** State shared between main.ts and the modules split out of it. Plain fields, no events: the owners read and assign them. */
import type { FocusState } from "./bodylogic";

/** Which bodies are hidden, see-through or in focus (view only: not saved, not sent to the core). Ids are stable, so a
 *  hidden body stays hidden through operations. */
export const bodyView: { hidden: ReadonlySet<number>; ghost: ReadonlySet<number>; focus: FocusState | null } = {
  hidden: new Set(),
  ghost: new Set(),
  focus: null,
};
