/** Placing the dividing line of the Divide face form by pressing and dragging over the model. */
import * as THREE from "three";
import { roundValue } from "./precision.ts";
import { pickHit, rayAt } from "./viewpick.ts";
import type { Viewport } from "./viewport.ts";

/** The part of the Viewport this file uses. */
export type DivideDragContext = Pick<Viewport, "camera" | "centresShown" | "data" | "divideDrag" | "divideFrame" | "faceStarts" | "ghostMaterial" | "ghosted" | "lastClick" | "mesh" | "onDivideDrag" | "originAxisHalf" | "pixelSizeAtDistance" | "probe" | "raycaster" | "renderer" | "surfaceMaterial">;

/**
 * With the Divide face form open, pressing on the model and dragging puts the dividing line through the pointer
 * on the face's plane. The line runs across the direction of the first clear movement (move along the face's
 * first axis and the line is parallel to the second); the offset follows the pointer. Returns whether it began.
 */
export function startDivideDrag(view: DivideDragContext, e: PointerEvent): boolean {
  const f = view.divideFrame;
  if (!f || e.ctrlKey || e.metaKey || !pickHit(view, e)) return false;
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(f.normal, f.centre);
  const start = rayAt(view, e).intersectPlane(plane, new THREE.Vector3());
  if (!start) return false; // looking edge-on along the face
  view.divideDrag = { plane, x: e.clientX, y: e.clientY, start, across: null, offset: 0 };
  view.renderer.domElement.setPointerCapture(e.pointerId);
  return true;
}

export function moveDivideDrag(view: DivideDragContext, e: PointerEvent) {
  const d = view.divideDrag!;
  const f = view.divideFrame;
  const at = f && rayAt(view, e).intersectPlane(d.plane, new THREE.Vector3());
  if (!f || !at) return;
  if (d.across === null) {
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
    const moved = at.clone().sub(d.start);
    // across 0 = line along u, positioned along v; so movement mostly along v keeps across 0.
    d.across = Math.abs(moved.dot(f.v)) >= Math.abs(moved.dot(f.u)) ? 0 : 1;
  }
  const step = d.across === 0 ? f.v : f.u;
  d.offset = roundValue(at.clone().sub(f.centre).dot(step));
  view.onDivideDrag(d.across, d.offset, false);
}
