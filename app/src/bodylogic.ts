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
