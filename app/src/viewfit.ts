/** Zoom to fit: put the model, the selection or a sketch's points in the free part of the 3D view. */
import * as THREE from "three";
import { fitBoxOf } from "./sketchfit.ts";
import { PERSPECTIVE_FOV } from "./viewcamera.ts";
import { syncOrtho } from "./viewcamera.ts";
import type { Viewport } from "./viewport.ts";

/** The part of the Viewport this file uses. */
export type FitContext = Pick<Viewport, "aspect" | "camera" | "controls" | "data" | "fitInsets" | "fitSource" | "keyLight" | "lastClip" | "mesh" | "onProjectionChange" | "orthoCamera" | "orthoHalf" | "orthographic" | "perspectiveCamera" | "renderer" | "scene" | "selected" | "sketchViewReturn">;

/** Zoom to the given world points exactly (no minimum size, except for a lone point), without turning the view. */
export function fitPoints(view: FitContext, points: number[][]) {
  frame(view, fitBoxOf(points), true, true, view.fitSource?.pad ?? 0);
}

/** Zoom so the whole visible model fills the view, without turning it. */
export function fitAll(view: FitContext) {
  const sketch = view.fitSource?.all();
  if (sketch) return fitPoints(view, sketch);
  if (!view.mesh) return;
  view.mesh.geometry.computeBoundingBox();
  const box = view.mesh.geometry.boundingBox;
  if (box && !box.isEmpty()) frame(view, [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z], true, true);
}

/** Zoom to the selected body, face, edge or vertex (the selection together, if several), without turning the view. Returns false when nothing is selected. */
export function fitSelected(view: FitContext): boolean {
  if (view.fitSource) {
    const sketch = view.fitSource.selected();
    if (sketch) fitPoints(view, sketch);
    return !!sketch;
  }
  const data = view.data;
  const box = new THREE.Box3();
  if (!data || !view.mesh || !view.selected.length) return false;
  const position = view.mesh.geometry.getAttribute("position");
  const index = view.mesh.geometry.getIndex()!.array;
  const point = new THREE.Vector3();
  const addFace = (f: { start: number; count: number }) => {
    for (let i = f.start; i < f.start + f.count; i++) box.expandByPoint(point.fromBufferAttribute(position, index[i]));
  };
  const addEdge = (e: { start: number; count: number }) => {
    for (let i = e.start; i < e.start + e.count; i++) box.expandByPoint(point.set(data.edgePositions[i * 3], data.edgePositions[i * 3 + 1], data.edgePositions[i * 3 + 2]));
  };
  for (const sel of view.selected) {
    if (sel.kind === "body") {
      data.faces.filter((f) => f.body === sel.id && f.count > 0).forEach(addFace);
      data.edges.filter((e) => e.body === sel.id && e.count > 0).forEach(addEdge);
    } else if (sel.kind === "face") {
      const f = data.faces.find((x) => x.id === sel.id);
      if (f) addFace(f);
    } else if (sel.kind === "edge") {
      const e = data.edges.find((x) => x.id === sel.id);
      if (e) addEdge(e);
    } else if (sel.kind === "vertex") {
      const v = data.vertices.find((x) => x.id === sel.id);
      if (v) box.expandByPoint(point.set(...v.position));
    }
  }
  if (box.isEmpty()) return false;
  // A lone vertex or a very small selection would zoom in absurdly far: keep a minimum size around it.
  const size = box.getSize(new THREE.Vector3());
  const minimum = (view.mesh.geometry.boundingBox ?? new THREE.Box3()).getSize(new THREE.Vector3()).length() * 0.05 || 1;
  if (size.length() < minimum) box.expandByVector(new THREE.Vector3().setScalar((minimum - size.length()) / 2));
  frame(view, [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z], true, true);
  return true;
}

/** Put the box in view. `inside`: fit it in the part of the view the overlays leave free (see `fitInsets`), with `padPx` of room around it. */
export function frame(view: FitContext, [x0, y0, z0, x1, y1, z1]: number[], keepDirection = false, inside = false, padPx = 0) {
  const center = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const radius = Math.max(Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2, 1e-3);
  let distance = radius / Math.sin((PERSPECTIVE_FOV * Math.PI) / 360);
  // The box sphere fills the view's height; shrink it into the free area and move its center to that area's middle.
  let shift = { x: 0, y: 0 };
  const rect = view.renderer.domElement.getBoundingClientRect();
  if (inside && rect.height > 0 && rect.width > 0) {
    const gap = view.fitInsets?.() ?? { top: 0, right: 0, bottom: 0, left: 0 };
    const freeH = Math.max(rect.height * 0.2, rect.height - gap.top - gap.bottom - 2 * padPx);
    const freeW = Math.max(rect.width * 0.2, rect.width - gap.left - gap.right - 2 * padPx);
    distance *= Math.max(1, rect.height / Math.min(freeH, freeW));
    shift = { x: (gap.left - gap.right) / 2, y: (gap.top - gap.bottom) / 2 };
  }
  view.orthoHalf = distance * Math.tan((PERSPECTIVE_FOV * Math.PI) / 360);
  view.orthoCamera.zoom = 1;
  syncOrtho(view);
  const direction = new THREE.Vector3(1, -1.4, 0.9);
  if (keepDirection) {
    const current = view.camera.position.clone().sub(view.controls.target);
    if (current.lengthSq() > 1e-12) direction.copy(current);
  }
  direction.normalize();
  const focus = center.clone();
  if (shift.x || shift.y) {
    // Move the looked-at point so the box's center lands on the middle of the free area (screen y runs down).
    const toward = direction.clone().negate();
    const right = toward.clone().cross(new THREE.Vector3(0, 0, 1));
    if (right.lengthSq() < 1e-12) right.set(1, 0, 0);
    right.normalize();
    const up = right.clone().cross(toward).normalize();
    const px = (2 * distance * Math.tan((PERSPECTIVE_FOV * Math.PI) / 360)) / rect.height;
    focus.addScaledVector(right, -shift.x * px).addScaledVector(up, shift.y * px);
  }
  view.camera.position.copy(focus).add(direction.multiplyScalar(distance));
  view.camera.near = distance / 100;
  view.camera.far = distance * 100;
  view.camera.updateProjectionMatrix();
  view.controls.target.copy(focus);
  view.controls.update();
}
