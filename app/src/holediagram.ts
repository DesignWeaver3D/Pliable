/** The Hole Editor's picture: a section through a hole with its dimensions named. Pure drawing (no model or card state), so it works
 *  in a floating card or a docked panel. The features switched on are drawn (a counterbore, a countersink, each at the opening or the far
 *  end, and a thread); each label is tagged with the form field it stands for (`data-param`), and the card focuses that field when the
 *  label is clicked. */
import type { HoleFeatures } from "./holefeatures.ts";

const NS = "http://www.w3.org/2000/svg";

function el(name: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
}

/** One dimension: a line between two points with arrow ticks at the ends and a label. */
function dimension(x1: number, y1: number, x2: number, y2: number, label: string, param: string | null, lx: number, ly: number, anchor = "middle"): SVGElement[] {
  const line = el("line", { x1, y1, x2, y2, stroke: "#ffb878", "stroke-width": 1, "marker-start": "url(#holearrow)", "marker-end": "url(#holearrow)" });
  const text = el("text", { x: lx, y: ly, fill: "#ffb878", "font-size": 10, "text-anchor": anchor, ...(param ? { "data-param": param, style: "cursor:pointer" } : {}) }, label);
  return [line, text];
}

/** The drawing for the features switched on. */
export function holeDiagram(features: HoleFeatures): SVGElement {
  const svg = el("svg", { viewBox: "0 0 230 150", width: "100%", role: "img", "aria-label": "Section through a hole" }) as SVGSVGElement;
  svg.style.cssText = "display:block;margin:2px 0 6px";
  const defs = el("defs", {});
  const arrow = el("marker", { id: "holearrow", viewBox: "0 0 6 6", refX: 3, refY: 3, markerWidth: 5, markerHeight: 5, orient: "auto-start-reverse" });
  arrow.append(el("path", { d: "M0,0 L6,3 L0,6 z", fill: "#ffb878" }));
  defs.append(arrow);
  const top = 28;
  const bottom = 118;
  const cx = 115;
  const half = 12; // half the bore
  const far = features.bore === 1 || features.sink === 1; // a step at the far end means the hole goes through
  const endY = far ? bottom : 96;
  const stepHalf = 26;
  const stepH = 24; // how far a step reaches into the material
  // One side of the cut-away profile (the material is the grey area around it), from the opening down to the end; the other side mirrors it.
  const left: [number, number][] = [];
  const stepAt = (kind: "bore" | "sink" | null, opening: boolean): [number, number][] => {
    const from = opening ? top : endY;
    const to = opening ? top + stepH : endY - stepH;
    if (kind === null) return [[cx - half, from]];
    return kind === "bore" ? [[cx - stepHalf, from], [cx - stepHalf, to], [cx - half, to]] : [[cx - stepHalf, from], [cx - half, to]];
  };
  const kindAt = (end: 0 | 1): "bore" | "sink" | null => (features.bore === end ? "bore" : features.sink === end ? "sink" : null);
  left.push(...stepAt(kindAt(0), true));
  if (far) left.push(...stepAt(kindAt(1), false).reverse());
  else left.push([cx - half, endY]);
  const right = left.map(([x, y]) => [2 * cx - x, y] as [number, number]).reverse();
  const outline = [...left, ...right].map(([x, y]) => `${x},${y}`).join(" ");
  svg.append(defs, el("rect", { x: 10, y: top, width: 210, height: bottom - top, fill: "#3a3f4a", stroke: "#666" }), el("polygon", { points: outline, fill: "#23262d", stroke: "#9aa", "stroke-width": 1 }));
  if (features.thread)
    for (let y = top + 8; y < endY - 4; y += 8) {
      svg.append(el("line", { x1: cx - half, y1: y, x2: cx - half - 4, y2: y - 3, stroke: "#9aa" }), el("line", { x1: cx + half, y1: y, x2: cx + half + 4, y2: y - 3, stroke: "#9aa" }));
    }
  // Dimensions: the bore's diameter at the bottom (beside the step of a through hole), its depth at the right, and each step's own size above or below it.
  const holeY = far ? (top + bottom) / 2 + 4 : endY + 10;
  svg.append(...dimension(cx - half, holeY, cx + half, holeY, "Ø hole", "diameter", cx, holeY + 12));
  svg.append(...dimension(cx + stepHalf + 18, top, cx + stepHalf + 18, endY, "depth", "depth", cx + stepHalf + 22, (top + endY) / 2 + 3, "start"));
  const sizeLabels = { bore: ["Ø counterbore", "bore_diameter", "step", "bore_depth"], sink: ["Ø countersink", "sink_diameter", "angle", "sink_angle"] } as const;
  for (const end of [0, 1] as const) {
    const kind = kindAt(end);
    if (kind === null) continue;
    const [diameterText, diameterParam, extraText, extraParam] = sizeLabels[kind];
    const lineY = end === 0 ? top - 8 : bottom + 8;
    svg.append(...dimension(cx - stepHalf, lineY, cx + stepHalf, lineY, diameterText, diameterParam, cx, end === 0 ? lineY - 4 : lineY + 12));
    const stepY = end === 0 ? top + stepH : endY - stepH;
    if (kind === "bore") {
      const [a, b] = end === 0 ? [top, stepY] : [stepY, endY];
      svg.append(...dimension(cx - stepHalf - 8, a, cx - stepHalf - 8, b, extraText, extraParam, cx - stepHalf - 12, (a + b) / 2 + 3, "end"));
    } else {
      const sweep = end === 0 ? 0 : 1;
      svg.append(el("path", { d: `M${cx - 14},${stepY + (end === 0 ? -1 : 1)} A14,14 0 0 ${sweep} ${cx + 14},${stepY + (end === 0 ? -1 : 1)}`, fill: "none", stroke: "#ffb878" }), el("text", { x: cx, y: stepY + (end === 0 ? 14 : -8), fill: "#ffb878", "font-size": 10, "text-anchor": "middle", "data-param": extraParam, style: "cursor:pointer" }, extraText));
    }
  }
  return svg;
}
