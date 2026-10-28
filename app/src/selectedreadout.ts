/** The names of the selected objects, printed bottom right beside the measurement card. */
import { entityOf, type SketchData, type SketchSel } from "./sketchmodel.ts";

const PLURALS: Record<string, string> = { line: "lines", circle: "circles", arc: "arcs", ellipse: "ellipses", spline: "splines", point: "points", axis: "axes" };

/** What is selected in a sketch, by kind and count: "2 lines, 1 point". */
export function sketchSelectionText(s: SketchData, sel: SketchSel[]): string {
  const counts = new Map<string, number>();
  for (const x of sel) {
    const kind = x.kind === "point" ? "point" : x.id < 0 ? "axis" : (entityOf(s, x.id)?.type ?? "curve");
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const text = [...counts].map(([kind, n]) => (n === 1 ? `1 ${kind}` : `${n} ${PLURALS[kind] ?? `${kind}s`}`)).join(", ");
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}

/** Keep the readout just left of the measurement card, whatever width that has or whether it is showing. */
export function followMeasureCard(readout: HTMLElement, card: HTMLElement): void {
  const place = () => {
    const shown = !card.hidden && card.getBoundingClientRect().width > 0;
    readout.style.right = shown ? `${Math.round(window.innerWidth - card.getBoundingClientRect().left + 12)}px` : "12px";
  };
  new ResizeObserver(place).observe(card);
  new MutationObserver(place).observe(card, { attributes: true, attributeFilter: ["hidden", "class", "style"] });
  window.addEventListener("resize", place);
  place();
}
