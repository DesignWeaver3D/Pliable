/** Drawing the open sketch each time it changes: curves, points, the grid, pending shapes and the dimensions. */
import { unstacked } from "./sketchstack.ts";
import * as THREE from "three";
import type { Dimension } from "./dimensions.ts";
import * as M from "./sketchmodel.ts";
import { buildGridGroup, disposeGrid } from "./sketchgrid.ts";
import * as Pv from "./sketchpreview.ts";
import * as Co from "./sketchcoincident.ts";
import * as Dr from "./sketchdraw.ts";
import { COLORS } from "./sketchdraw.ts";
import { FREE_COLOR, freeParts } from "./sketchfreedom.ts";
import { dimensionMenu, dragDimension, driveAndEdit, editInline, markMenu, selectDimension } from "./sketchdimactions.ts";
import { outsideGeometry } from "./sketchrefresh.ts";
import { renderPanel } from "./sketchpanel.ts";
import type { SketchMode } from "./sketch.ts";

const CONSTRUCTION_DASH_PX = 8;
const CONSTRUCTION_GAP_PX = 5;

/** Rebuild the grid for the current options (nothing when it is off). */
export function buildGrid(mode: SketchMode, f: ReturnType<typeof M.frame> = M.frame(mode.s.plane)) {
  if (mode.grid) {
    mode.group.remove(mode.grid);
    disposeGrid(mode.grid);
    mode.grid = null;
  }
  if (!mode.options.grid) return;
  mode.grid = buildGridGroup(mode.options, COLORS.grid, f);
  mode.group.add(mode.grid);
}

export function onFrame(mode: SketchMode) {
  const size = mode.viewport.renderer.getSize(new THREE.Vector2());
  for (const l of [mode.axes, mode.normal, mode.placed, mode.construction, mode.free, mode.marked, mode.pending, mode.centres]) l.material.resolution.set(size.x, size.y);
  const pixel = mode.pixelAt(0, 0); // dashes keep their screen size as the view zooms
  if (mode.active && Math.abs(pixel - mode.centresAt) > mode.centresAt * 0.01) Dr.drawCentres(mode); // so do the center crosses
  mode.construction.material.dashSize = CONSTRUCTION_DASH_PX * pixel;
  mode.construction.material.gapSize = CONSTRUCTION_GAP_PX * pixel;
}

export function lightUp(mode: SketchMode, c: M.SketchConstraint | null) {
  const ids = c ? [...(c.entities ?? []), ...(c.entity !== undefined ? [c.entity] : [])] : [];
  const points = c ? [...(c.points ?? []), ...(c.point !== undefined ? [c.point] : [])] : [];
  mode.highlight = [...points.map((id) => ({ kind: "point" as const, id })), ...ids.map((id) => ({ kind: "entity" as const, id }))];
  renderSketch(mode, false); // keep the panel: rebuilding it under the pointer would end the hover
}

export function renderSketch(mode: SketchMode, panel = true) {
  if (!mode.active) return;
  const normal: [number, number][][] = [];
  const marked: [number, number][][] = [];
  const guides: [number, number][][] = [];
  const placed: [number, number][][] = [];
  const lit: [number, number][][] = [];
  const open = mode.showFree ? freeParts(mode.s, mode.freedom, mode.freeSizes) : null;
  const stacked: { a: [number, number]; b: [number, number] }[] = []; // construction lines, cut so stacked ones are dashed once
  const pointUV = (id: number): [number, number] => [M.pointOf(mode.s, id).u, M.pointOf(mode.s, id).v];
  for (const e of [...mode.s.entities].sort((p, q) => M.entityLength(mode.s, q) - M.entityLength(mode.s, p))) { // longer first, so a shorter curve stacked on a longer one is drawn on top
    const bucket = Dr.isMarked(mode, { kind: "entity", id: e.id }) ? marked : open?.entities.has(e.id) ? lit : e.construction ? guides : Dr.isPlaced(mode, e) ? placed : normal;
    if (bucket === guides && e.type === "line") stacked.push({ a: pointUV(e.a), b: pointUV(e.b) });
    else bucket.push(M.polyline(mode.s, e));
    mode.centreColours.set(e.id, bucket === marked ? COLORS.selected : bucket === lit ? FREE_COLOR : bucket === guides ? COLORS.construction : bucket === placed ? COLORS.placed : COLORS.line);
  }
  Dr.drawCentres(mode);
  Dr.drawAxes(mode);
  Dr.setLine(mode.normal, Dr.segments(mode, normal));
  guides.push(...unstacked(stacked));
  Dr.setLine(mode.construction, Dr.segments(mode, guides));
  Dr.setLine(mode.marked, Dr.segments(mode, marked));
  Dr.setLine(mode.placed, Dr.segments(mode, placed));
  Dr.setLine(mode.free, Dr.segments(mode, lit));
  Dr.setLine(mode.pending, Dr.segments(mode, pendingShapes(mode)));

  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();
  // The sketch origin goes last so it is drawn over any vertex that sits on it.
  const atOrigin = (p: M.SketchPoint) => p.fixed && Math.hypot(p.u, p.v) < 1e-6;
  for (const p of [...mode.s.points.filter((q) => !atOrigin(q)), ...mode.s.points.filter(atOrigin)]) {
    positions.push(...Dr.world(mode, p.u, p.v).toArray());
    color.set(Dr.isMarked(mode, { kind: "point", id: p.id }) ? COLORS.selected : open?.points.has(p.id) ? FREE_COLOR : mode.cursor?.id === p.id ? COLORS.hover : p.fixed ? COLORS.construction : mode.freedom.get(p.id) === 0 ? COLORS.placed : COLORS.line);
    colors.push(color.r, color.g, color.b);
  }
  mode.points.geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  mode.points.geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  mode.points.geometry.computeBoundingSphere();
  const dimensions = M.dimensionsOf(mode.s, outsideGeometry(mode)).map((d) => {
    const c = mode.s.constraints.find((x) => x.id === d.constraint);
    if (!c) return d;
    const drag = (e: PointerEvent) => dragDimension(mode, c.id, e);
    const marked = { selected: mode.selectedDimensions.has(c.id), reference: !!c.reference, select: (e: MouseEvent) => selectDimension(mode, c.id, e.shiftKey || e.ctrlKey || e.metaKey), menu: (e: MouseEvent) => void dimensionMenu(mode, c.id, e) };
    return !c.reference && c.value !== undefined ? { ...d, ...marked, drag, activate: (at: { x: number; y: number }) => editInline(mode, c.id, at) } : { ...d, ...marked, drag, ...(c.reference && c.value !== undefined ? { activate: (at: { x: number; y: number }) => void driveAndEdit(mode, c.id, at) } : {}) };
  });
  mode.overlay.set([...dimensions, ...(mode.showMarks ? M.constraintMarks({ ...mode.s, constraints: [...mode.s.constraints, ...Co.sharedMarks(mode.s)] }).map((m) => (m.constraint === undefined ? m : { ...m, selected: mode.selectedDimensions.has(m.constraint), select: (e: MouseEvent) => selectDimension(mode, m.constraint!, e.shiftKey || e.ctrlKey || e.metaKey), menu: (e: MouseEvent) => void markMenu(mode, m.constraint!, e) })) : []), ...liveDimensions(mode)]);
  if (panel) renderPanel(mode);
  mode.onToolChange?.(); // the strip's constraint row follows the selection
}

/** Size tags next to the cursor while a shape is being placed: length and angle, width by height, or radius. */
export function liveDimensions(mode: SketchMode): Dimension[] {
  return Pv.liveDimensions(mode);
}

/** Rubber-band shapes for the drawing in progress. */
export function pendingShapes(mode: SketchMode): [number, number][][] {
  return Pv.pendingShapes(mode);
}
