/** Drawing one dimension of the overlay: linear, angle and leader dimensions, constraint tags, and the value label with its gap in the lines. */
import { gapSegment } from "./dimensiongap.ts";
import { CONSTRAINT_ICONS } from "./icons.ts";
import { DIM_OFFSET_PX, EXT_OVERSHOOT_PX, EXT_GAP_PX, ARROW_PX, LEADER_PX, LANDING_PX, TEXT_PX, MARK_ICON_PX, MARK_VERTEX_PX, MARK_GAP_PX, CURSOR_CLEAR_PX, LINE_COLOR, HALO_COLOR, GAP_PAD_PX, HALO_OPACITY, NS, type V, sub, add, mul, len, unit, CENTER_CLEAR_PX, overlaps, textWidth, line, arrow } from "./dimensionsvg.ts";
import { hitArea } from "./dimensioninteract.ts";
import type { Dimension, DimensionOverlay } from "./dimensions.ts";

/** The part of the DimensionOverlay this file uses. */
export type DimDrawContext = Pick<DimensionOverlay, "activatedAt" | "clash" | "current" | "dims" | "drewLabel" | "editing" | "iconTurn" | "lastTap" | "onActivate" | "pending" | "placed" | "pointer" | "tapDown">;

/** A tag, tried in its outward place first and then in each alternative until it does not land on another one. */
export function drawTag(ov: DimDrawContext, d: Dimension, project: (p: number[]) => V, mine: SVGElement[]) {
  for (const way of d.outward ? [d.outward, ...(d.alternatives ?? [])] : [undefined]) {
    mine.length = 0;
    ov.pending = [];
    ov.clash = false;
    ov.iconTurn = turnOf(ov, d, project);
    drawLabel(ov, clearOf(ov, pushed(ov, project(d.points[0]), d, project, way), d, project), d.text, mine);
    if (!ov.clash) return;
  }
}

/** The turn (degrees) that puts an icon's vertical centerline along `iconAlong` as it looks on the screen; 0 when there is none or it is seen end-on. */
export function turnOf(ov: DimDrawContext, d: Dimension, project: (p: number[]) => V): number {
  if (d.iconFacing) {
    const a = project(d.points[0]);
    const b = project(d.points[0].map((c, k) => c + d.iconFacing![k]));
    return Math.hypot(b.x - a.x, b.y - a.y) < 1e-6 ? 0 : (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  }
  if (!d.iconAlong) return 0;
  const a = project(d.points[0]);
  const b = project(d.points[0].map((c, k) => c + d.iconAlong![k]));
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  return Math.hypot(dx, dy) < 1e-6 ? 0 : (Math.atan2(dx, -dy) * 180) / Math.PI;
}

/** How far on the screen a mark sits from its point, the same clearance for every kind of mark: half a vertex square, the mark's own half size along the way it leaves, and a gap. */
export function standoff(ov: DimDrawContext, d: Dimension, way: V): number {
  const reach = d.icon ? MARK_ICON_PX / 2 + 1 : Math.abs(way.x) * (textWidth(d.text) / 2) + Math.abs(way.y) * (TEXT_PX / 2 + 2);
  return MARK_VERTEX_PX + reach + MARK_GAP_PX;
}

/** A tag's point moved a fixed distance on the screen along its outward direction (a tangent mark off the curve). */
export function pushed(ov: DimDrawContext, at: V, d: Dimension, project: (p: number[]) => V, way = d.outward): V {
  if (!way) return at;
  const toward = project(d.points[0].map((c, k) => c + way[k]));
  const away = unit(sub(toward, at));
  return add(at, mul(away, standoff(ov, d, away)));
}

/** A tag's place moved up, out of the way of the points it must not cover (a center point and its highlight). */
export function clearOf(ov: DimDrawContext, at: V, d: Dimension, project: (p: number[]) => V): V {
  const half = { x: textWidth(d.text) / 2 + 6, y: TEXT_PX / 2 + 8 };
  let p = at;
  for (const q of (d.avoid ?? []).map(project)) if (Math.abs(p.x - q.x) < half.x && Math.abs(p.y - q.y) < half.y) p = { x: p.x, y: q.y - half.y };
  return p;
}

export function drawLinear(ov: DimDrawContext, d: Dimension, project: (p: number[]) => V, out: SVGElement[]) {
  const a = project(d.points[0]);
  const b = project(d.points[1]);
  const along = unit(sub(b, a));
  if (len(sub(b, a)) < 2) {
    // Seen end-on the two points coincide: only the value can be shown.
    drawLabel(ov, a, d.text, out);
    return;
  }
  let side: V;
  if (d.offsetDirection) {
    const o = d.offsetDirection;
    side = sub(project(d.points[0].map((c, k) => c + o[k])), a);
    side = len(side) < 1e-3 ? { x: -along.y, y: along.x } : unit(side);
  } else {
    // A distance between two items has no natural side: put the dimension line on the upper (or right) side.
    side = { x: -along.y, y: along.x };
    if (side.y > 1e-6 || (Math.abs(side.y) <= 1e-6 && side.x < 0)) side = mul(side, -1);
  }
  let off = mul(side, DIM_OFFSET_PX);
  let slide: V = { x: 0, y: 0 };
  if (d.offset !== undefined && d.offsetDirection) {
    // Placed by the user: the line sits at the dragged distance, the text at the dragged place along it.
    const o = d.offsetDirection;
    const moved = (p: number[], k: number) => project(p.map((c, i) => c + o[i] * k));
    off = sub(moved(d.points[0], d.offset), a);
    if (d.slide) {
      const mid = d.points[0].map((c, i) => (c + d.points[1][i]) / 2);
      const dir = d.points[1].map((c, i) => c - d.points[0][i]);
      const length = Math.hypot(...dir) || 1;
      slide = sub(project(mid.map((c, i) => c + (dir[i] / length) * d.slide!)), project(mid));
    }
  }
  const a2 = add(a, off);
  const b2 = add(b, off);
  for (const [p, q] of [
    [a, a2],
    [b, b2],
  ] as const) {
    const dir = unit(sub(q, p));
    out.push(line(add(p, mul(dir, EXT_GAP_PX)), add(q, mul(dir, EXT_OVERSHOOT_PX))));
  }
  // Text pulled past either extension line: the arrows go outside the extension lines, pointing in, and the line runs on to the text.
  let pulled = slide.x * along.x + slide.y * along.y;
  // A value too wide for the room between the arrows goes past the far extension line, with the dimension line run on to it.
  const room = len(sub(b2, a2));
  const width = textWidth(d.text);
  if (Math.abs(pulled) <= room / 2 && room < width + 2 * ARROW_PX + 4) {
    pulled = room / 2 + ARROW_PX + 4 + width / 2;
    slide = mul(along, pulled);
  }
  dimLine(ov, a2, b2, out, Math.abs(pulled) > len(sub(b2, a2)) / 2 ? pulled : undefined);
  drawLabel(ov, add(mul(add(a2, b2), 0.5), slide), d.text, out);
}

/** An arc between the two lines with an arrowhead at each end, extension lines out to it, and the value on its middle (beside it when the arc is short). */
export function drawAngle(ov: DimDrawContext, d: Dimension, project: (p: number[]) => V, out: SVGElement[]) {
  const apex = project(d.points[0]);
  const arc = d.points.slice(1).map(project);
  for (let i = 1; i < arc.length; i++) out.push(line(arc[i - 1], arc[i]));
  out.push(arrow(arc[0], unit(sub(arc[0], arc[1]))), arrow(arc[arc.length - 1], unit(sub(arc[arc.length - 1], arc[arc.length - 2]))));
  for (const [p, q] of d.extend ?? []) {
    const [from, to] = [project(p), project(q)];
    const dir = unit(sub(to, from));
    out.push(line(from, add(to, mul(dir, EXT_OVERSHOOT_PX))));
  }
  const mid = arc[Math.floor(arc.length / 2)];
  let length = 0;
  for (let i = 1; i < arc.length; i++) length += len(sub(arc[i], arc[i - 1]));
  const width = textWidth(d.text);
  const away = unit(sub(mid, apex));
  drawLabel(ov, length < width + 3 * ARROW_PX ? add(mid, mul(away, width / 2 + ARROW_PX)) : mid, d.text, out);
}

export function drawLeader(ov: DimDrawContext, d: Dimension, project: (p: number[]) => V, out: SVGElement[]) {
  const a = project(d.points[0]);
  const b = project(d.points[1]);
  // The rim point the leader touches and the way it leaves the feature (away from the center).
  const rim = b;
  const outDir = unit(sub(b, a));
  if (d.kind === "diameter") {
    // The dimension line spans the hole; the leader leaves from its far end.
    dimLine(ov, a, b, out);
    gapLines(ov, out, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, { x: CENTER_CLEAR_PX, y: CENTER_CLEAR_PX }); // the center point stays visible and pickable
  } else {
    out.push(line(add(a, mul(outDir, CENTER_CLEAR_PX)), b)); // starts clear of the center point, which has no dot of the dimension on it
  }
  if (d.kind !== "diameter") out.push(arrow(rim, outDir));
  // Leader: continues past the rim, then a horizontal landing that carries the text.
  const placed = d.labelAt ? project(d.labelAt) : null; // dragged by the user: bend where it was dropped
  const knee = placed ?? add(rim, mul(outDir, LEADER_PX));
  const side = placed ? (placed.x < rim.x ? -1 : 1) : outDir.x < 0 ? -1 : 1;
  const end = add(knee, { x: side * LANDING_PX, y: 0 });
  out.push(line(rim, knee), line(knee, end));
  for (const [p, q] of d.extend ?? []) { // an arc's circle carried on to where the leader sits (dashed)
    const part = line(project(p), project(q));
    part.setAttribute("stroke-dasharray", "4 3");
    out.push(part);
  }
  drawLabel(ov, add(end, { x: side * (d.text.length * TEXT_PX * 0.275 + 6), y: 0 }), d.text, out);
}

/** A dimension line with an arrowhead at each end: inside the span, or outside it when the span is too short. */
export function dimLine(ov: DimDrawContext, a: V, b: V, out: SVGElement[], textAlong?: number) {
  const dir = unit(sub(b, a));
  if (textAlong !== undefined) {
    // `textAlong`: how far from the middle, along the line, the text sits (past one end).
    const mid = mul(add(a, b), 0.5);
    const tail = mul(dir, ARROW_PX + 6);
    // Nothing is drawn between the extension lines: a short tail behind the far arrow, and a line from the near arrow out to the text.
    const toText = add(mid, mul(dir, textAlong));
    if (textAlong > 0) out.push(line(sub(a, tail), a), line(b, toText));
    else out.push(line(toText, a), line(b, add(b, tail)));
    out.push(arrow(a, dir), arrow(b, mul(dir, -1)));
    return;
  }
  if (len(sub(b, a)) < 2.5 * ARROW_PX) {
    const tail = mul(dir, ARROW_PX + 6);
    out.push(line(sub(a, tail), add(b, tail)), arrow(a, dir), arrow(b, mul(dir, -1)));
    return;
  }
  out.push(line(a, b), arrow(a, mul(dir, -1)), arrow(b, dir));
}

/** Cut the dimension's own lines (those already drawn into `out`) around the padded rectangle of its value, so they look broken there; nothing else is hidden. */
export function gapLines(ov: DimDrawContext, out: SVGElement[], centre: V, half: V) {
  for (let i = out.length - 1; i >= 0; i--) {
    const el = out[i];
    if (el.tagName !== "line") continue;
    const [a, b] = [{ x: Number(el.getAttribute("x1")), y: Number(el.getAttribute("y1")) }, { x: Number(el.getAttribute("x2")), y: Number(el.getAttribute("y2")) }];
    const pieces = gapSegment(a, b, centre, half.x, half.y, 0);
    if (pieces.length === 1 && pieces[0][0] === a && pieces[0][1] === b) continue;
    out.splice(i, 1, ...pieces.map(([from, to]) => line(from, to)));
  }
}

export function drawLabel(ov: DimDrawContext, at: V, text: string, out: SVGElement[]) {
  const dim = ov.dims[ov.current];
  const interactive = !!(dim?.edit || dim?.editNote || dim?.activate || dim?.drag || dim?.select);
  let p = at;
  if (!interactive && ov.pointer && len(sub(p, ov.pointer)) < CURSOR_CLEAR_PX) {
    p = add(ov.pointer, mul(unit(sub(p, ov.pointer)), CURSOR_CLEAR_PX));
  }
  const icon = dim?.icon ? CONSTRAINT_ICONS[dim.icon] : undefined;
  const half = icon ? { x: MARK_ICON_PX / 2, y: MARK_ICON_PX / 2 } : { x: textWidth(text) / 2, y: TEXT_PX / 2 + 2 };
  const box = { x0: p.x - half.x, x1: p.x + half.x, y0: p.y - half.y, y1: p.y + half.y };
  if (ov.placed.some((q) => overlaps(q, box))) ov.clash = true;
  ov.pending.push(box);
  // Values are always drawn upright (horizontal on the screen), whatever way their line runs.
  if (!dim?.mark) gapLines(ov, out, p, { x: half.x + GAP_PAD_PX, y: half.y + GAP_PAD_PX }); // the dimension's lines break around its value
  const g = document.createElementNS(NS, "g");
  g.setAttribute("transform", `translate(${p.x},${p.y})`);
  if (interactive) ov.drewLabel = p;
  const hidden = ov.editing === ov.current;
  if (icon) {
    // The button's icon (a 24 px drawing) scaled to the mark size, over a soft dark disc so it reads on any surface.
    const back = document.createElementNS(NS, "circle");
    back.setAttribute("r", String(MARK_ICON_PX / 2 + 1));
    back.setAttribute("fill", HALO_COLOR);
    back.setAttribute("fill-opacity", "0.6");
    const art = document.createElementNS(NS, "g");
    art.setAttribute("transform", `rotate(${ov.iconTurn}) translate(${-MARK_ICON_PX / 2},${-MARK_ICON_PX / 2}) scale(${MARK_ICON_PX / 24})`);
    art.setAttribute("fill", "none");
    art.setAttribute("stroke-width", "1.8");
    art.setAttribute("stroke-linecap", "round");
    art.setAttribute("stroke-linejoin", "round");
    art.setAttribute("style", `stroke: ${dim?.selected ? "#ff8a1f" : LINE_COLOR}; color: ${dim?.selected ? "#ff8a1f" : LINE_COLOR}`);
    art.innerHTML = icon;
    g.append(back, art);
    if (interactive && !hidden) g.append(hitArea(ov, half, dim, p));
    out.push(g);
    return;
  }
  const t = document.createElementNS(NS, "text");
  t.textContent = hidden ? "" : text;
  t.setAttribute("text-anchor", "middle");
  t.setAttribute("dominant-baseline", "central");
  t.setAttribute("font-size", String(TEXT_PX));
  t.setAttribute("font-family", "system-ui, sans-serif");
  t.setAttribute("style", `fill: ${dim?.selected ? "#ff8a1f" : LINE_COLOR}`);
  t.setAttribute("stroke", HALO_COLOR);
  t.setAttribute("stroke-opacity", HALO_OPACITY);
  t.setAttribute("stroke-width", "3");
  t.setAttribute("paint-order", "stroke");
  g.append(t);
  if (interactive && !hidden) g.append(hitArea(ov, half, dim, p));
  out.push(g);
}
