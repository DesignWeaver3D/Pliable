/** The Delete key for the project lists: which objects it removes. Bodies selected in the list or the view go together as one
 *  undo step; a sketch or datum plane row that was clicked goes alone. The key does nothing while typing, in a sketch or with a tool form open. */
export interface RowRef {
  list: "sketch" | "datum";
  id: number;
}

export interface DeleteContext {
  /** Body ids in the current selection (empty when something else is selected). */
  bodies: number[];
  /** The sketch or datum row last clicked, until a body is selected. */
  row: RowRef | null;
  typing: boolean;
  blocked: boolean;
}

export type DeleteAction = { kind: "bodies"; ids: number[] } | { kind: "row"; row: RowRef } | null;

export function deleteAction(key: string, ctx: DeleteContext): DeleteAction {
  if (key !== "Delete" || ctx.typing || ctx.blocked) return null;
  if (ctx.row) return { kind: "row", row: ctx.row };
  if (ctx.bodies.length) return { kind: "bodies", ids: ctx.bodies };
  return null;
}

/** Whether the element takes typed text (the Delete key then belongs to it). */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
}
