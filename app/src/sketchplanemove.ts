/** Moving the open sketch's plane: its handles in the 3D view, picking a point to move from or to, and Flip. */
import * as THREE from "three";
import * as M from "./sketchmodel.ts";
import { LENGTH_UNIT } from "./units.ts";
import type { HandleInfo } from "./tools.ts";
import { pushUndo } from "./sketchundo.ts";
import { refreshProfiles, resolveSketch } from "./sketchrefresh.ts";
import { buildGrid, renderSketch } from "./sketchrender.ts";
import { renderPanel } from "./sketchpanel.ts";
import type { SketchMode } from "./sketch.ts";

/** Gizmos on the sketch plane, like any other object's: an arrow along its normal and a turning ring about each of its axes. */
export function showPlaneHandles(mode: SketchMode) {
  const manipulator = mode.viewport.manipulator;
  if (!mode.active || mode.unwrapFace || !mode.gizmosShown) return manipulator.clear();
  const f = M.frame(mode.s.plane);
  const radius = 30;
  const v = (a: number[]) => new THREE.Vector3(...a);
  const ring = (param: string, label: string, about: M.Vec3, from: M.Vec3, toward: M.Vec3): HandleInfo => {
    const around = v(from).multiplyScalar(Math.SQRT1_2).addScaledVector(v(toward), Math.SQRT1_2);
    const tangent = v(toward).multiplyScalar(Math.SQRT1_2).addScaledVector(v(from), -Math.SQRT1_2);
    const anchor = v(f.origin).addScaledVector(around, radius);
    return { param, label, anchor: anchor.toArray(), direction: tangent.toArray(), scale: (180 / Math.PI) / radius, min: null, max: null, toggle: false, unit: "°", axis: about, ring: [...f.origin, radius], value: 0 };
  };
  manipulator.setHandles([
    { param: "plane_offset", label: "Move sketch plane", anchor: [...f.origin], direction: [...f.n], scale: 1, min: null, max: null, toggle: false, kind: "move", unit: LENGTH_UNIT, value: 0 },
    ring("plane_rx", "Turn sketch plane about its x axis", f.x, f.y, f.n),
    ring("plane_ry", "Turn sketch plane about its y axis", f.y, f.n, f.x),
  ]);
}

/** A plane handle was dragged: place the plane from where it was grabbed, offset along its normal or turned about one of its axes. */
export function onPlaneDrag(mode: SketchMode, param: string, value: number, phase: "move" | "end" | "cancel"): boolean {
  if (!mode.active || !param.startsWith("plane_")) return false;
  mode.planeBase ??= { origin: [...mode.s.plane.origin], normal: [...mode.s.plane.normal], xdir: [...mode.s.plane.xdir] };
  const base = mode.planeBase;
  const f = M.frame(base);
  const v = (a: number[]) => new THREE.Vector3(...a);
  const n = v(f.n);
  const x = v(f.x);
  const origin = v(f.origin);
  if (phase !== "cancel") {
    if (param === "plane_offset") origin.addScaledVector(n, value);
    else {
      const about = param === "plane_rx" ? x : v(f.y);
      const q = new THREE.Quaternion().setFromAxisAngle(about, (value * Math.PI) / 180);
      n.applyQuaternion(q);
      x.applyQuaternion(q);
    }
  }
  mode.s.plane = { origin: origin.toArray(), normal: n.toArray(), xdir: x.toArray() };
  const g = M.frame(mode.s.plane);
  mode.plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(...g.n), new THREE.Vector3(...g.origin));
  buildGrid(mode, g);
  renderSketch(mode);
  if (phase !== "move") {
    mode.planeBase = null;
    showPlaneHandles(mode);
    void refreshProfiles(mode); // the tinted regions are drawn in model space: they follow the plane
  }
  return true;
}

/** Pick a point in the view while the sketch is open: the point picker takes over the pointer and hands it back. */
export async function pickInView(mode: SketchMode): Promise<number[] | null> {
  const keep = mode.viewport.interceptor;
  mode.viewport.manipulator.clear();
  try {
    return await mode.host.pickPoint();
  } finally {
    mode.viewport.interceptor = keep;
    showPlaneHandles(mode);
  }
}

/** Move the sketch plane by the vector from the picked base point to a picked destination (from the plane's own origin when no base was picked). */
export async function moveToPicked(mode: SketchMode, destination: number[], from: number[]) {
  const origin = mode.s.plane.origin;
  mode.s.plane = { ...mode.s.plane, origin: origin.map((c, k) => c + destination[k] - from[k]) };
  const f = M.frame(mode.s.plane);
  mode.plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(...f.n), new THREE.Vector3(...f.origin));
  buildGrid(mode, f);
  showPlaneHandles(mode);
  renderSketch(mode);
}

/** The header's pick-base-point button: remember where the move starts from. */
export async function pickMoveFrom(mode: SketchMode) {
  const point = await pickInView(mode);
  if (!point || !mode.active) return;
  mode.moveFrom = point;
  mode.host.showBase(point);
  mode.host.status("Base point set. Now pick the location to move the sketch plane to");
  renderPanel(mode);
}

/** The header's pick-move-to-location button: put the plane there, by the base point's offset (or its own origin). */
export async function pickMoveTo(mode: SketchMode) {
  const point = await pickInView(mode);
  if (!point || !mode.active) return;
  const from = mode.moveFrom ?? [...mode.s.plane.origin];
  mode.moveFrom = null;
  mode.host.showBase(null);
  await moveToPicked(mode, point, from);
  mode.host.status("Moved the sketch plane");
  renderPanel(mode);
}

/** Bring the picking plane, the grid and the plane gizmos in line with the sketch's plane (after a flip, or an undo or redo of one). */
export function syncPlane(mode: SketchMode) {
  const f = M.frame(mode.s.plane);
  mode.plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(...f.n), new THREE.Vector3(...f.origin));
  buildGrid(mode, f);
  showPlaneHandles(mode);
}

/** Flip the sketch to the other side of its plane: the core reverses the normal and converts the points so nothing moves in space; one undo step, and the view turns to look from the new side. */
export async function flipPlane(mode: SketchMode) {
  pushUndo(mode);
  try {
    const reply = await mode.core.request<{ sketch: M.SketchData }>("sketch_flip", { sketch: mode.s });
    mode.s = reply.sketch;
  } catch (e) {
    mode.undoStack.pop();
    mode.host.status(`Could not flip the sketch: ${e instanceof Error ? e.message : String(e)}`, true);
    return;
  }
  mode.selection = [];
  mode.chain = [];
  syncPlane(mode);
  await resolveSketch(mode);
  renderSketch(mode);
  mode.viewport.lookFromOrthographic(new THREE.Vector3(...M.frame(mode.s.plane).n));
}
