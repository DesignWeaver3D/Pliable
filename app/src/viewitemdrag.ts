/** The tool drag of the selection in the 3D view: its start, its direction, the distance the pointer implies, and its end or cancel. */
import * as THREE from "three";
import { roundValue } from "./precision.ts";
import type { Hit, Measure } from "./viewport.ts";
import { drawMeasures, endMeasure, findMeasures } from "./viewdragmeasure.ts";
import type { Viewport } from "./viewport.ts";

/** The part of the Viewport this file uses. */
export type ItemDragContext = Pick<Viewport, "camera" | "controls" | "data" | "drag" | "dragReleased" | "holdDrag" | "lastDistance" | "measureAll" | "measureHot" | "measureHover" | "measureMode" | "measureSel" | "measures" | "mesh" | "onItemDrag" | "onMeasureChange" | "primaryMeasure" | "renderer" | "selected" | "toPixels">;

/** Starts the tool drag of the selection: the one path behind both a direct face press and the face's arrow handle. */
export function beginItemDrag(view: ItemDragContext, e: PointerEvent, direction: THREE.Vector3, point: THREE.Vector3, faceId: number | null) {
  view.dragReleased = false;
  view.drag = { sels: [...view.selected], normal: direction, point, x: e.clientX, y: e.clientY, moved: false };
  // The edges come from the face pressed, also when companion faces (the "With parallel face" chips) are selected with it.
  view.measures = faceId !== null ? findMeasures(view, { kind: "face", id: faceId }, direction, point) : [];
  view.primaryMeasure = view.measures.reduce<Measure | null>(
    (best, m) => (best === null || m.anchor.distanceTo(point) < best.anchor.distanceTo(point) ? m : best),
    null,
  );
  drawMeasures(view, 0);
}

/** Axis a picked item is dragged along (faces: normal, edges: outward bisector), or null if it has none. */
export function dragDirection(view: ItemDragContext, hit: Hit): THREE.Vector3 | null {
  const normal =
    hit.kind === "face"
      ? view.data?.faces.find((f) => f.id === hit.id)?.normal
      : hit.kind === "edge"
        ? view.data?.edges.find((e) => e.id === hit.id)?.normal
        : null;
  if (normal) return new THREE.Vector3(...normal);
  // A whole hole or boss wall has no single normal: it is pushed or pulled along the wall's normal where it was
  // pressed, and the core changes the radius by the distance (docs/protocol.md, push_pull).
  if (hit.kind === "face" && hit.surfaceNormal && view.data?.centres.some((c) => c.face === hit.id)) return hit.surfaceNormal.clone();
  return null;
}

/** Distance along the dragged item's axis implied by the pointer position. */
export function dragDistance(view: ItemDragContext, e: PointerEvent, drag = view.drag!): number {
  const rect = view.renderer.domElement.getBoundingClientRect();
  const toPixels = (p: THREE.Vector3) => {
    const n = p.clone().project(view.camera);
    return new THREE.Vector2(((n.x + 1) / 2) * rect.width, ((1 - n.y) / 2) * rect.height);
  };
  const length = view.camera.position.distanceTo(drag.point) * 0.25;
  const p0 = toPixels(drag.point);
  let axis = toPixels(drag.point.clone().addScaledVector(drag.normal, length)).sub(p0);
  if (axis.length() < 2) axis = new THREE.Vector2(0, -100); // looking along the normal
  const delta = new THREE.Vector2(e.clientX - drag.x, e.clientY - drag.y);
  return roundValue((delta.dot(axis) / axis.lengthSq()) * length);
}

/** Cancels the current drag, even while a typed value holds it (the window lost focus). */
export function cancelDrag(view: ItemDragContext) {
  const drag = view.drag;
  if (!drag) return;
  view.drag = null;
  view.holdDrag = false;
  view.controls.enabled = true;
  endMeasure(view);
  view.onItemDrag(drag.sels, 0, "cancel");
}

/** Ends the current drag as if the pointer was released (used when a typed value is committed); later pointer events are ignored. */
export function finishDrag(view: ItemDragContext) {
  const drag = view.drag;
  if (!drag) return;
  view.drag = null;
  view.holdDrag = false;
  view.controls.enabled = true;
  view.onItemDrag(drag.sels, 0, "end"); // reads measureSel synchronously, so clear it afterwards
  endMeasure(view);
}
