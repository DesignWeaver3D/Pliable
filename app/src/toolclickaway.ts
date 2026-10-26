/** What a change of the selection does to an open tool card: only a click on empty space (nothing selected afterwards) applies the tool.
 *  Clicking another item changes nothing: the tool stays open on the selection it was opened on, and the pick is not carried over.
 *  Using a gizmo or handle never goes through here, so it neither applies nor closes the tool. No DOM. */
export type ClickAway = "apply" | "ignore";

export function clickAway(next: readonly unknown[]): ClickAway {
  return next.length === 0 ? "apply" : "ignore";
}
