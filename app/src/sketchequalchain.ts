/** The Equal constraints joined to one another through the curves they name (equal #1 #2 and equal #2 #3 are one chain); selecting one mark selects the chain. No DOM. */
import type { SketchConstraint } from "./sketchmodel.ts";

/** The ids of the Equal constraints in the chain of `id` (including it); just `[id]` when it is not an Equal constraint. */
export function equalChain(constraints: SketchConstraint[], id: number): number[] {
  const start = constraints.find((c) => c.id === id);
  if (!start || start.type !== "equal") return [id];
  const equals = constraints.filter((c) => c.type === "equal");
  const curves = new Set<number>(start.entities ?? []);
  const chain = new Set<number>([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const c of equals) {
      if (chain.has(c.id) || !(c.entities ?? []).some((e) => curves.has(e))) continue;
      chain.add(c.id);
      (c.entities ?? []).forEach((e) => curves.add(e));
      grew = true;
    }
  }
  return [...chain];
}
