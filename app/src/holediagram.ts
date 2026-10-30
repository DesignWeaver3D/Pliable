/** The Hole Editor's picture: a section through a hole with its dimensions named. Pure drawing (no model or card state), so it works
 *  in a floating card or a docked panel. `shape` picks which way of making the hole is drawn; each label is tagged with the form
 *  field it stands for (`data-param`), and the card focuses that field when the label is clicked. */
export type HoleShape = "simple" | "counterbore" | "countersink";

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

/** The drawing for one shape; `thread` adds the teeth of a threaded wall. */
export function holeDiagram(shape: HoleShape, thread = false): SVGElement {
  const svg = el("svg", { viewBox: "0 0 230 140", width: "100%", role: "img", "aria-label": `Section through a ${shape} hole` }) as SVGSVGElement;
  svg.style.cssText = "display:block;margin:2px 0 6px";
  const defs = el("defs", {});
  const arrow = el("marker", { id: "holearrow", viewBox: "0 0 6 6", refX: 3, refY: 3, markerWidth: 5, markerHeight: 5, orient: "auto-start-reverse" });
  arrow.append(el("path", { d: "M0,0 L6,3 L0,6 z", fill: "#ffb878" }));
  defs.append(arrow);
  const top = 28;
  const bottom = 118;
  const cx = 115;
  const half = 12; // half the bore
  const depthY = 96;
  const stepHalf = 26;
  const stepY = 52;
  // The cut-away profile of the hole (the material is the grey area around it).
  const left: [number, number][] = [];
  if (shape === "counterbore") left.push([cx - stepHalf, top], [cx - stepHalf, stepY], [cx - half, stepY]);
  else if (shape === "countersink") left.push([cx - stepHalf, top], [cx - half, stepY]);
  else left.push([cx - half, top]);
  left.push([cx - half, depthY]);
  const right = left.map(([x, y]) => [2 * cx - x, y] as [number, number]).reverse();
  const outline = [...left, ...right].map(([x, y]) => `${x},${y}`).join(" ");
  svg.append(defs, el("rect", { x: 10, y: top, width: 210, height: bottom - top, fill: "#3a3f4a", stroke: "#666" }), el("polygon", { points: outline, fill: "#23262d", stroke: "#9aa", "stroke-width": 1 }));
  if (thread)
    for (let y = top + 8; y < depthY - 4; y += 8) {
      svg.append(el("line", { x1: cx - half, y1: y, x2: cx - half - 4, y2: y - 3, stroke: "#9aa" }), el("line", { x1: cx + half, y1: y, x2: cx + half + 4, y2: y - 3, stroke: "#9aa" }));
    }
  // Dimensions: the bore's diameter at the bottom, its depth at the right, and the step's own size above or beside it.
  svg.append(...dimension(cx - half, depthY + 10, cx + half, depthY + 10, "Ø hole", "diameter", cx, depthY + 22));
  svg.append(...dimension(cx + stepHalf + 18, top, cx + stepHalf + 18, depthY, "depth", "depth", cx + stepHalf + 22, (top + depthY) / 2 + 3, "start"));
  if (shape === "counterbore") {
    svg.append(...dimension(cx - stepHalf, top - 8, cx + stepHalf, top - 8, "Ø counterbore", "bore_diameter", cx, top - 12));
    svg.append(...dimension(cx - stepHalf - 8, top, cx - stepHalf - 8, stepY, "step", "bore_depth", cx - stepHalf - 12, (top + stepY) / 2 + 3, "end"));
  } else if (shape === "countersink") {
    svg.append(...dimension(cx - stepHalf, top - 8, cx + stepHalf, top - 8, "Ø countersink", "sink_diameter", cx, top - 12));
    svg.append(el("path", { d: `M${cx - 14},${stepY - 1} A14,14 0 0 0 ${cx + 14},${stepY - 1}`, fill: "none", stroke: "#ffb878" }), el("text", { x: cx, y: stepY + 14, fill: "#ffb878", "font-size": 10, "text-anchor": "middle", "data-param": "sink_angle", style: "cursor:pointer" }, "angle"));
  }
  return svg;
}
