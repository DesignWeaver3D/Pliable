/** Dragging a hole's center dot in the 3D view moves the hole in the plane across its axis. */
import * as THREE from "three";
import { occluded, rayAt } from "./viewpick.ts";
import { isSelected, selectItems } from "./viewselection.ts";
import type { Viewport } from "./viewport.ts";

const CENTRE_HANDLE_PX = 7; // pressing this close to a hole center dot starts moving the hole

/** The part of the Viewport this file uses. */
export type CentreDragContext = Pick<Viewport, "camera" | "centreDots" | "centreDrag" | "centresShown" | "data" | "faceStarts" | "ghostMaterial" | "ghosted" | "hoverLine" | "hoverMark" | "hovered" | "lastClick" | "markSource" | "mesh" | "model" | "onCentreDrag" | "onHoverBody" | "onSelect" | "originAxisHalf" | "pixelSizeAtDistance" | "probe" | "raycaster" | "relatedMarks" | "renderer" | "selected" | "selectedLine" | "selectedMarks" | "surfaceMaterial">;

/** Pressing on a hole center dot (not just near the hole) begins moving that hole; returns whether it did. */
export function startCentreDrag(view: CentreDragContext, e: PointerEvent): boolean {
  if (!view.centresShown.length || e.ctrlKey || e.metaKey) return false;
  const rect = view.renderer.domElement.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  for (const c of view.centresShown) {
    const p = new THREE.Vector3(...c.position);
    const n = p.clone().project(view.camera);
    if (n.z > 1 || Math.hypot(((n.x + 1) / 2) * rect.width - px, ((1 - n.y) / 2) * rect.height - py) > CENTRE_HANDLE_PX || occluded(view, p)) continue;
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(...c.axis).normalize(), p);
    const start = rayAt(view, e).intersectPlane(plane, new THREE.Vector3());
    if (!start) return false; // looking edge-on along the hole's plane
    view.centreDrag = { face: c.face, origin: p, plane, start, x: e.clientX, y: e.clientY, moved: false };
    if (!isSelected(view, { kind: "face", id: c.face })) {
      const sel = { kind: "face" as const, id: c.face, centre: true };
      selectItems(view, [sel]);
      view.onSelect([sel]);
    }
    view.renderer.domElement.setPointerCapture(e.pointerId);
    return true;
  }
  return false;
}

export function centreOffset(view: CentreDragContext, e: PointerEvent, c: NonNullable<Viewport["centreDrag"]>): THREE.Vector3 {
  const at = rayAt(view, e).intersectPlane(c.plane, new THREE.Vector3());
  return at ? at.sub(c.start) : new THREE.Vector3();
}

export function moveCentreDrag(view: CentreDragContext, e: PointerEvent) {
  const c = view.centreDrag!;
  const offset = centreOffset(view, e, c);
  if (!c.moved && Math.hypot(e.clientX - c.x, e.clientY - c.y) < 4) return;
  c.moved = true;
  view.onCentreDrag(c.face, offset, "move");
}
