// Pure rules of the body list (hide, isolate, row selection), kept apart from the page so they can be tested.

/** Hidden ids after the eye of `id` is toggled. */
export function toggleHidden(hidden: ReadonlySet<number>, id: number): Set<number> {
  const next = new Set(hidden);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** A body is isolated when it is the only visible one (and there is more than one body). */
export function isIsolated(hidden: ReadonlySet<number>, all: readonly number[], id: number): boolean {
  return all.length > 1 && !hidden.has(id) && all.every((other) => other === id || hidden.has(other));
}

/** Hidden ids after the isolate toggle of `id`: isolating hides every other body, toggling it off shows all. */
export function toggleIsolated(hidden: ReadonlySet<number>, all: readonly number[], id: number): Set<number> {
  if (isIsolated(hidden, all, id)) return new Set();
  return new Set(all.filter((other) => other !== id));
}

/** Hidden ids that still name a body. */
export function pruneHidden(hidden: ReadonlySet<number>, all: readonly number[]): Set<number> {
  const present = new Set(all);
  return new Set([...hidden].filter((id) => present.has(id)));
}

/** The selection after a click on a row: plain replaces, Ctrl toggles, Shift takes the range from the anchor. */
export function clickRows(order: readonly number[], current: readonly number[], anchor: number | null, id: number, mods: { ctrl: boolean; shift: boolean }): { ids: number[]; anchor: number } {
  if (mods.shift && anchor !== null && order.includes(anchor)) {
    const a = order.indexOf(anchor);
    const b = order.indexOf(id);
    const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
    return { ids: mods.ctrl ? [...new Set([...current, ...range])] : range, anchor };
  }
  if (mods.ctrl) return { ids: current.includes(id) ? current.filter((x) => x !== id) : [...current, id], anchor: id };
  return { ids: [id], anchor: id };
}

/** What a double-click on a hit selects: a face gives its whole body; an edge keeps the chain meaning (handled
 *  elsewhere); anything else (a vertex, empty space, a face of unknown body) does nothing new. */
export function doubleClickBody(hit: { kind: string; id: number } | null, bodyOfFace: (faceId: number) => number | null | undefined): number | null {
  if (!hit || hit.kind !== "face") return null;
  return bodyOfFace(hit.id) ?? null;
}

/** See-through ids after the X of `id` is toggled. */
export function toggleGhost(ghost: ReadonlySet<number>, id: number): Set<number> {
  const next = new Set(ghost);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** What the Focus toggle remembers: the bodies it made see-through (so turning it off leaves hand-ghosted ones alone). */
export interface FocusState {
  /** The focused body. */
  body: number;
  /** The bodies Focus ghosted (they were solid before). */
  added: ReadonlySet<number>;
}

/** The see-through set and focus memory after Focus is pressed on `id`: pressing it on the focused body restores,
 *  pressing it on another body moves the focus there (hand-ghosted bodies stay ghosted throughout). */
export function toggleFocus(
  ghost: ReadonlySet<number>,
  focus: FocusState | null,
  all: readonly number[],
  id: number,
): { ghost: Set<number>; focus: FocusState | null } {
  const next = new Set(ghost);
  if (focus) for (const b of focus.added) next.delete(b);
  if (focus && focus.body === id) return { ghost: next, focus: null };
  const added = new Set<number>();
  for (const b of all) {
    if (b !== id && !next.has(b)) {
      next.add(b);
      added.add(b);
    }
  }
  next.delete(id); // the focused body stays solid even if it was ghosted by hand
  return { ghost: next, focus: { body: id, added } };
}

/** Drop ids of bodies that no longer exist; the focus ends when its body is gone. */
export function pruneGhost(
  ghost: ReadonlySet<number>,
  focus: FocusState | null,
  all: readonly number[],
): { ghost: Set<number>; focus: FocusState | null } {
  const present = new Set(all);
  const kept = new Set([...ghost].filter((id) => present.has(id)));
  if (!focus || !present.has(focus.body)) return { ghost: kept, focus: null };
  return { ghost: kept, focus: { body: focus.body, added: new Set([...focus.added].filter((id) => present.has(id))) } };
}
