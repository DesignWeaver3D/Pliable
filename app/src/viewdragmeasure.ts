/** Measure mode during a face drag: the straight edges whose length changes with the face, drawn and picked so one can be typed instead of the drag distance. */
import * as THREE from "three";
import { projectOnSegment } from "./segmentmath.ts";
import type { Measure, Sel } from "./viewport.ts";
import type { Viewport } from "./viewport.ts";

const MEASURE_PICK_PX = 10; // pick radius for measurement edges in measure mode
const MEASURE_TOL = 1e-3; // model units: on-plane / parallel tolerance when finding measurable edges

/** The part of the Viewport this file uses. */
export type DragMeasureContext = Pick<Viewport, "camera" | "data" | "drag" | "holdDrag" | "lastDistance" | "measureAll" | "measureHot" | "measureHover" | "measureMode" | "measureSel" | "measures" | "mesh" | "onItemDrag" | "onMeasureChange" | "primaryMeasure" | "renderer" | "toPixels">;

/** Straight edges parallel to the face normal with exactly one end on the face (and inside it). */
export function findMeasures(view: DragMeasureContext, sel: Sel, normal: THREE.Vector3, point: THREE.Vector3): Measure[] {
  const data = view.data;
  const range = sel.kind === "face" ? data?.faces.find((f) => f.id === sel.id) : undefined;
  if (!data || !view.mesh || !range) return [];
  const position = view.mesh.geometry.getAttribute("position");
  const index = view.mesh.geometry.getIndex()!.array;
  const triangles: THREE.Triangle[] = [];
  for (let i = range.start; i < range.start + range.count; i += 3) {
    triangles.push(
      new THREE.Triangle(
        new THREE.Vector3().fromBufferAttribute(position, index[i]),
        new THREE.Vector3().fromBufferAttribute(position, index[i + 1]),
        new THREE.Vector3().fromBufferAttribute(position, index[i + 2]),
      ),
    );
  }
  const onFace = (p: THREE.Vector3) => triangles.some((t) => t.closestPointToPoint(p, new THREE.Vector3()).distanceTo(p) < MEASURE_TOL);
  const out: Measure[] = [];
  for (const edge of data.edges) {
    if (edge.count !== 2) continue;
    const a = new THREE.Vector3().fromArray(data.edgePositions, edge.start * 3);
    const b = new THREE.Vector3().fromArray(data.edgePositions, (edge.start + 1) * 3);
    const length = a.distanceTo(b);
    if (length < MEASURE_TOL || Math.abs(b.clone().sub(a).dot(normal)) < length * (1 - 1e-6)) continue;
    const da = a.clone().sub(point).dot(normal);
    const db = b.clone().sub(point).dot(normal);
    const aOn = Math.abs(da) < MEASURE_TOL;
    const bOn = Math.abs(db) < MEASURE_TOL;
    if (aOn === bOn) continue;
    const [anchor, fixed, otherSide] = aOn ? [a, b, db] : [b, a, da];
    if (onFace(anchor)) out.push({ fixed, anchor, length, grow: otherSide < 0 ? 1 : -1 });
  }
  return out;
}

export function drawMeasures(view: DragMeasureContext, distance: number) {
  view.lastDistance = distance;
  const normal = view.drag?.normal ?? new THREE.Vector3();
  const segments = (list: Measure[]) =>
    list.flatMap((m) => [...m.fixed.toArray(), ...m.anchor.clone().addScaledVector(normal, distance).toArray()]);
  const hot = view.measureSel ?? view.measureHover ?? view.primaryMeasure;
  view.measureAll.visible = view.measureMode && view.measures.length > 0;
  if (view.measureAll.visible) view.measureAll.geometry.setPositions(segments(view.measures));
  view.measureHot.visible = hot !== null;
  if (hot) view.measureHot.geometry.setPositions(segments([hot]));
}

export function endMeasure(view: DragMeasureContext) {
  view.measureMode = false;
  view.measureSel = view.measureHover = view.primaryMeasure = null;
  view.measures = [];
  view.measureAll.visible = view.measureHot.visible = false;
}

export function nearestMeasure(view: DragMeasureContext, e: PointerEvent): Measure | null {
  const rect = view.renderer.domElement.getBoundingClientRect();
  const n = view.drag?.normal;
  if (!n) return null;
  const pointer = new THREE.Vector2(e.clientX - rect.left, e.clientY - rect.top);
  let best: Measure | null = null;
  let bestDistance = MEASURE_PICK_PX;
  view.camera.updateMatrixWorld();
  for (const m of view.measures) {
    const a = view.toPixels(m.fixed, rect);
    const b = view.toPixels(m.anchor.clone().addScaledVector(n, view.lastDistance), rect);
    const d = projectOnSegment(pointer.x, pointer.y, a.x, a.y, b.x, b.y).dist;
    if (d < bestDistance) {
      bestDistance = d;
      best = m;
    }
  }
  return best;
}

/** Measure mode on or off; only meaningful during a tool drag. Bound to the "measure" key action in keys.ts. */
export function toggleMeasureKey(view: DragMeasureContext): string | null {
  const drag = view.drag;
  if (!drag) return "Measure pick works while a face is being dragged: press and hold a face, then press the measure key";
  if (!view.measureMode && view.measures.length === 0) return "Nothing to measure to: this face has no straight edge running along its push/pull direction";
  if (!drag.moved) {
    // Pressed before the pointer left the click threshold: the drag starts here, as if it had moved by zero.
    drag.moved = true;
    view.onItemDrag(drag.sels, 0, "move", drag.x, drag.y);
  }
  toggleMeasure(view);
  return null;
}

export function toggleMeasure(view: DragMeasureContext) {
  if (view.measureMode) {
    view.measureMode = false;
    view.holdDrag = false;
    view.measureSel = null;
  } else if (view.measures.length > 0) {
    view.measureMode = true;
    view.holdDrag = true;
    view.measureSel = view.primaryMeasure ?? view.measures[0];
  } else return;
  drawMeasures(view, view.lastDistance);
  view.onMeasureChange();
}
