/** Drawing the sketch into the scene: the line layers, the axes and the center crosses. Moved out of sketch.ts;
 *  `SketchMode` is the context. */
import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import * as M from "./sketchmodel.ts";

export const CENTRE_CROSS_PX = 10; // half the width of a circle or arc center cross
export const COLORS = { line: 0xb8a4ff, selected: 0xff8a1f, hover: 0xffffff, pending: 0xffe066, construction: 0x7f8794, grid: 0x3a4150, placed: 0x8fe388, conflict: 0xff5a5a };

export interface DrawContext {
  s: M.SketchData;
  selection: M.SketchSel[];
  highlight: M.SketchSel[];
  hover: M.SketchSel | null;
  /** Directions each point can still move in (0 = placed by the constraints). */
  freedom: Map<number, number>;
  failed: Set<number>;
  freeSizes: Set<number>;
  axes: LineSegments2;
  centres: LineSegments2;
  /** The color of each circle's and arc's cross, set as the curves are drawn. */
  centreColours: Map<number, number>;
  /** The pixel size the crosses were last built for. */
  centresAt: number;
  pixelAt(u: number, v: number): number;
}

export function world(ctx: DrawContext, u: number, v: number): THREE.Vector3 {
  return new THREE.Vector3(...M.toWorld(ctx.s.plane, u, v));
}

export function segments(ctx: DrawContext, lines: [number, number][][]): number[] {
  const out: number[] = [];
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i++) out.push(...world(ctx, ...line[i]).toArray(), ...world(ctx, ...line[i + 1]).toArray());
  }
  return out;
}

export function isMarked(ctx: DrawContext, sel: M.SketchSel) {
  const same = (s: M.SketchSel) => s.kind === sel.kind && s.id === sel.id;
  return ctx.selection.some(same) || ctx.highlight.some(same) || (ctx.hover?.kind === sel.kind && ctx.hover.id === sel.id);
}

/** Whether the constraints already place every point of the entity (drawn green, like a fully constrained shape). */
export function isPlaced(ctx: DrawContext, e: M.SketchEntity): boolean {
  if (!ctx.freedom.size || ctx.failed.size || ctx.freeSizes.has(e.id)) return false;
  const ids = M.entityPoints(e);
  return ids.length > 0 && ids.every((id) => ctx.freedom.get(id) === 0);
}

export function drawAxes(ctx: DrawContext) {
  const reach = 400;
  const positions: number[] = [];
  const colors: number[] = [];
  for (const [i, a] of M.sketchAxes(ctx.s.plane).entries()) {
    positions.push(...world(ctx, a.u - a.du * reach, a.v - a.dv * reach).toArray(), ...world(ctx, a.u + a.du * reach, a.v + a.dv * reach).toArray());
    const c = new THREE.Color(isMarked(ctx, { kind: "entity", id: -1 - i }) ? COLORS.selected : [0xd9534f, 0x5cb85c, 0x4a90e2][a.axis]); // the axes are the entities below zero (see M.entityOf)
    colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
  }
  ctx.axes.visible = positions.length > 0;
  if (!positions.length) return;
  ctx.axes.geometry.dispose();
  ctx.axes.geometry = new LineSegmentsGeometry().setPositions(positions).setColors(colors);
}

export function drawCentres(ctx: DrawContext) {
  const pixel = ctx.pixelAt(0, 0);
  ctx.centresAt = pixel;
  const arm = CENTRE_CROSS_PX * pixel;
  const lines: [number, number][][] = [];
  const colors: number[] = [];
  const color = new THREE.Color();
  for (const e of ctx.s.entities) {
    if (e.type !== "circle" && e.type !== "arc") continue;
    const c = M.pointOf(ctx.s, e.center);
    lines.push([[c.u - arm, c.v], [c.u + arm, c.v]], [[c.u, c.v - arm], [c.u, c.v + arm]]);
    color.set(ctx.centreColours.get(e.id) ?? COLORS.line);
    for (let k = 0; k < 4; k++) colors.push(color.r, color.g, color.b);
  }
  setLine(ctx.centres, segments(ctx, lines));
  if (lines.length) ctx.centres.geometry.setColors(colors);
}

export function setLine(line: LineSegments2, positions: number[]) {
  line.visible = positions.length > 0;
  if (!positions.length) return;
  // A fresh geometry each time: reusing one whose segment count grows left it drawing only the first segments.
  line.geometry.dispose();
  line.geometry = new LineSegmentsGeometry().setPositions(positions);
  if (line.material.dashed) line.computeLineDistances();
}
