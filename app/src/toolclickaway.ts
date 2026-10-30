/** What a change of the selection does to an open tool card: only a click on empty space (nothing selected afterwards) applies the tool.
 *  Clicking another item changes nothing: the tool stays open on the selection it was opened on, and the pick is not carried over.
 *  Using a gizmo or handle never goes through here, so it neither applies nor closes the tool. No DOM. */
export type ClickAway = "apply" | "ignore";

export function clickAway(next: readonly unknown[]): ClickAway {
  return next.length === 0 ? "apply" : "ignore";
}

/** A card that opened on a selection (the Hole Editor) and was never changed has nothing to apply, so a selection change just closes it (it may open again on the new selection).
 *  Once a value has been changed it follows `clickAway` like every other tool card: empty space applies it, another item leaves it open. */
export function closesUnchangedCard(isCard: boolean, hasPreview: boolean): boolean {
  return isCard && !hasPreview;
}
