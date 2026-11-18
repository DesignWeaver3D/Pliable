/** A development-only window onto what the canvas shows, for the browser tests (uitests/): the sketch's curves and points as data,
 *  the line layers each curve is drawn on, and where things are on screen. It only reads what the app already holds and drew;
 *  it decides nothing itself and changes nothing. It is installed only in a development build. */
import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import * as Dr from "./sketchdraw.ts";
import * as M from "./sketchmodel.ts";
import type { SketchMode } from "./sketch.ts";
import type { Viewport } from "./viewport.ts";

export interface ScreenPoint {
  x: number;
  y: number;
}

/** One of the sketch's line layers as it is drawn now. */
export interface LayerInfo {
  /** The layer's name in the sketch mode (normal, construction, marked, ...). */
  name: string;
  dashed: boolean;
  /** The line color as six hex digits. */
  color: string;
  width: number;
}

export interface CurveInfo {
  id: number;
  type: string;
  construction: boolean;
  selected: boolean;
  /** The pointer is over it, or a constraint in the list is lighting it up. */
  hovered: boolean;
  highlighted: boolean;
  /** Every visible layer that draws this curve at its middle. */
  layers: LayerInfo[];
  /** The middle of the curve in the page, for a click. */
  at: ScreenPoint;
}

export interface SketchInfo {
  tool: string;
  /** A drag of a point or curve is in progress. */
  dragging: boolean;
  curves: CurveInfo[];
  points: { id: number; selected: boolean; at: ScreenPoint }[];
}

export interface TestHook {
  /** The open sketch, or null when none is open. */
  sketch(): SketchInfo | null;
  /** Where a place on the sketch plane is in the page. */
  sketchToScreen(u: number, v: number): ScreenPoint;
}

/** The distance from point `p` to the segment from `a` to `b`. */
export function distanceToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = b.clone().sub(a);
  const length2 = ab.lengthSq();
  const t = length2 === 0 ? 0 : Math.min(1, Math.max(0, p.clone().sub(a).dot(ab) / length2));
  return a.clone().addScaledVector(ab, t).distanceTo(p);
}

/** Whether a line layer's geometry has a segment that passes through `p`. */
function draws(layer: LineSegments2, p: THREE.Vector3, tolerance: number): boolean {
  const start = layer.geometry.getAttribute("instanceStart");
  const end = layer.geometry.getAttribute("instanceEnd");
  if (!start || !end) return false;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (let i = 0; i < start.count; i++) {
    if (distanceToSegment(p, a.fromBufferAttribute(start, i), b.fromBufferAttribute(end, i)) <= tolerance) return true;
  }
  return false;
}

/** The middle of a curve's drawn outline, on the sketch plane. */
function middle(outline: [number, number][]): [number, number] {
  const k = Math.max(0, Math.floor((outline.length - 2) / 2));
  const [p, q] = [outline[k], outline[Math.min(k + 1, outline.length - 1)]];
  return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
}

export function createTestHook(viewport: Viewport, mode: SketchMode): TestHook {
  const toScreen = (world: THREE.Vector3): ScreenPoint => {
    const box = viewport.renderer.domElement.getBoundingClientRect();
    const ndc = world.clone().project(viewport.camera);
    return { x: box.left + ((ndc.x + 1) / 2) * box.width, y: box.top + ((1 - ndc.y) / 2) * box.height };
  };
  const lineLayers = (): [string, LineSegments2][] =>
    Object.entries(mode).filter((entry): entry is [string, LineSegments2] => entry[1] instanceof LineSegments2);
  const has = (kind: "point" | "entity", id: number) => mode.selection.some((s) => s.kind === kind && s.id === id);
  return {
    sketchToScreen: (u, v) => toScreen(Dr.world(mode, u, v)),
    sketch() {
      if (!mode.active) return null;
      const layers = lineLayers().filter(([, layer]) => layer.visible);
      const tolerance = 1e-6 * Math.max(1, mode.pixelAt(0, 0));
      const curves = mode.s.entities.map((e): CurveInfo => {
        const [u, v] = middle(M.polyline(mode.s, e));
        const at = Dr.world(mode, u, v);
        return {
          id: e.id,
          type: e.type,
          construction: !!e.construction,
          selected: has("entity", e.id),
          hovered: mode.hover?.kind === "entity" && mode.hover.id === e.id,
          highlighted: mode.highlight.some((h) => h.kind === "entity" && h.id === e.id),
          layers: layers
            .filter(([, layer]) => draws(layer, at, tolerance))
            .map(([name, layer]) => ({ name, dashed: !!layer.material.dashed, color: layer.material.color.getHexString(), width: layer.material.linewidth })),
          at: toScreen(at),
        };
      });
      const points = mode.s.points.map((p) => ({ id: p.id, selected: has("point", p.id), at: toScreen(Dr.world(mode, p.u, p.v)) }));
      return { tool: mode.tool, dragging: mode.drag !== null, curves, points };
    },
  };
}
