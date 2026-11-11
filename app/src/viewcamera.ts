/** The 3D view's camera: perspective or orthographic projection, the standard views, looking along a direction or at a face, and the clipping range.
 *  `Viewport` passes itself as the context. */
import * as THREE from "three";
import { averageFaceDirection } from "./viewfacedir.ts";
import type { Viewport } from "./viewport.ts";

export const PERSPECTIVE_FOV = 45;
const ISO_DIRECTION = new THREE.Vector3(1, -1.4, 0.9).normalize(); // from the target toward the camera

/** Standard views, numbered (0 isometric, 1 front, 2 top, 3 right, 4 rear, 5 bottom, 6 left); Z is up. */
export const STANDARD_VIEWS: Record<string, THREE.Vector3> = {
  iso: ISO_DIRECTION,
  front: new THREE.Vector3(0, -1, 0),
  top: new THREE.Vector3(0, -1e-4, 1).normalize(), // tilted a hair so "up" on screen stays defined
  right: new THREE.Vector3(1, 0, 0),
  rear: new THREE.Vector3(0, 1, 0),
  bottom: new THREE.Vector3(0, -1e-4, -1).normalize(),
  left: new THREE.Vector3(-1, 0, 0),
};

/** The part of the Viewport this file uses. */
export type CameraContext = Pick<Viewport, "aspect" | "camera" | "controls" | "data" | "keyLight" | "lastClip" | "mesh" | "onProjectionChange" | "orthoCamera" | "orthoHalf" | "orthographic" | "perspectiveCamera" | "scene" | "sketchViewReturn">;

/** Size the orthographic frustum to the viewport's aspect ratio. */
export function syncOrtho(view: CameraContext) {
  const c = view.orthoCamera;
  c.top = view.orthoHalf;
  c.bottom = -view.orthoHalf;
  c.right = view.orthoHalf * view.aspect;
  c.left = -c.right;
  c.updateProjectionMatrix();
}

/** Look straight down a direction (from the side it points to), keeping target and distance. */
export function lookFrom(view: CameraContext, direction: THREE.Vector3) {
  const d = direction.clone().normalize();
  if (Math.abs(d.z) > 0.9999) d.y -= 1e-4; // keep "up" defined
  d.normalize();
  const distance = view.camera.position.distanceTo(view.controls.target);
  view.camera.position.copy(view.controls.target).addScaledVector(d, distance);
  view.controls.update();
}

/** Switch between perspective and orthographic, keeping what is framed the same size. */
export function setOrthographic(view: CameraContext, on: boolean) {
  if (on === view.orthographic) return;
  view.sketchViewReturn = null; // a projection chosen by hand ends any pending return
  const target = view.controls.target;
  const from = view.camera;
  const to = on ? view.orthoCamera : view.perspectiveCamera;
  const tan = Math.tan((PERSPECTIVE_FOV * Math.PI) / 360);
  const distance = from.position.distanceTo(target);
  if (on) {
    view.orthoHalf = distance * tan; // what the perspective view shows at the target
    view.orthoCamera.zoom = 1;
    syncOrtho(view);
  } else {
    view.perspectiveCamera.position.copy(target).addScaledVector(from.position.clone().sub(target).normalize(), view.orthoHalf / view.orthoCamera.zoom / tan);
  }
  if (on) to.position.copy(from.position);
  to.quaternion.copy(from.quaternion);
  from.remove(view.keyLight);
  view.scene.remove(from);
  to.add(view.keyLight);
  view.scene.add(to);
  view.camera = to;
  view.controls.object = to;
  view.lastClip = 0;
  fitClipping(view, true);
  view.controls.update();
  view.onProjectionChange();
}

/** Look straight down a direction in orthographic projection, remembering a perspective view so that turning the camera brings it back. */
export function lookFromOrthographic(view: CameraContext, direction: THREE.Vector3) {
  const remember = !view.orthographic || view.sketchViewReturn !== null; // pressed again in the same switched view: still remembered
  setOrthographic(view, true);
  view.sketchViewReturn = null; // turning to the sketch must not count as turning away
  lookFrom(view, direction);
  if (remember) view.sketchViewReturn = view.camera.position.clone().sub(view.controls.target).normalize();
}

export function returnFromSketchView(view: CameraContext) {
  if (!view.sketchViewReturn) return;
  const now = view.camera.position.clone().sub(view.controls.target).normalize();
  if (now.dot(view.sketchViewReturn) > 0.99985) return; // still looking along the sketch (zoom and pan keep it)
  setOrthographic(view, false);
}

/** Look at the model from a standard direction (a key of STANDARD_VIEWS), keeping target and distance. */
export function setView(view: CameraContext, name: string) {
  const direction = STANDARD_VIEWS[name];
  if (!direction) return;
  const distance = view.camera.position.distanceTo(view.controls.target);
  view.camera.position.copy(view.controls.target).addScaledVector(direction, distance);
  view.controls.update();
}

/** Look straight at a planar face, from the side its normal points to. Returns false if the face is not planar. */
export function alignToFace(view: CameraContext, faceId: number): boolean {
  const face = view.data?.faces.find((f) => f.id === faceId);
  if (!face) return false;
  const direction = face.normal ? new THREE.Vector3(...face.normal) : averageFaceDirection(view, face);
  if (!direction) return false;
  if (Math.abs(direction.z) > 0.9999) direction.y -= 1e-4; // keep "up" defined
  direction.normalize();
  const distance = view.camera.position.distanceTo(view.controls.target);
  view.camera.position.copy(view.controls.target).addScaledVector(direction, distance);
  view.controls.update();
  return true;
}

/** Near and far planes follow the camera distance (it changes a lot between perspective and orthographic). */
export function fitClipping(view: CameraContext, force = false) {
  const distance = view.camera.position.distanceTo(view.controls.target);
  if (!force && Math.abs(distance - view.lastClip) < view.lastClip * 0.01) return;
  view.lastClip = distance;
  view.camera.near = distance / 100;
  view.camera.far = distance * 100;
  view.camera.updateProjectionMatrix();
}

/** CSS matrix3d string for a cube drawn in the camera's orientation (see navcube.ts). */
export function viewMatrixCss(view: CameraContext): string {
  view.camera.updateMatrixWorld();
  const e = view.camera.matrixWorldInverse.elements; // column-major, world to camera
  // css-local (x right, y down, z toward viewer) -> world (x, -z, -y) -> camera -> css (flip y)
  const r = (row: number, col: number) => e[col * 4 + row];
  // Camera-space image of each css-local axis.
  const cols = [
    [r(0, 0), -r(1, 0), r(2, 0)], // css x -> world X
    [-r(0, 2), r(1, 2), -r(2, 2)], // css y (down) -> world -Z
    [-r(0, 1), r(1, 1), -r(2, 1)], // css z (toward viewer) -> world -Y
  ];
  const m = [...cols[0], 0, ...cols[1], 0, ...cols[2], 0, 0, 0, 0, 1];
  return `matrix3d(${m.join(",")})`;
}
