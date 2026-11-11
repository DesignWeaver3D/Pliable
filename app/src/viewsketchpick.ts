/** Picking kept sketches in the 3D view: the tinted profile region or the drawn curve under the pointer, and the click that chooses one. */
import * as THREE from "three";
import { settings } from "./settings.ts";
import { projectOnSegment } from "./segmentmath.ts";
import { pickCycling } from "./viewpick.ts";
import { clickSelect } from "./viewselection.ts";
import type { Viewport } from "./viewport.ts";

/** The part of the Viewport this file uses. */
export type SketchPickContext = Pick<Viewport, "camera" | "centreDots" | "centresShown" | "curveTargets" | "data" | "faceStarts" | "ghostMaterial" | "ghosted" | "hoverLine" | "hoverMark" | "hovered" | "lastClick" | "markSource" | "mesh" | "model" | "onHoverBody" | "onProfileClick" | "onSelect" | "onSketchCurveClick" | "originAxisHalf" | "pixelSizeAtDistance" | "probe" | "profileTargets" | "raycaster" | "relatedMarks" | "renderer" | "selected" | "selectedLine" | "selectedMarks" | "surfaceMaterial">;

/** A click: a profile region of a kept sketch that is not behind the model counts as a face; otherwise the usual pick. */
export function clickOrProfile(view: SketchPickContext, e: PointerEvent, additive: boolean) {
  const picked = pickCycling(view, e);
  if (additive && (!picked || picked.kind === "face")) {
    const curve = curveUnder(view, e, 4); // Shift or Ctrl+click right on a kept sketch's curve chooses the whole sketch (kept beside the selection)
    if (curve !== null) return view.onSketchCurveClick(curve);
  }
  const profile = !picked || picked.kind === "face" ? profileUnder(view, e) : null;
  if (profile) view.onProfileClick(profile.id, profile.region, additive);
  else clickSelect(view, picked, additive);
}

/** The kept sketch whose drawn curve passes within a few pixels of the pointer and is not hidden behind the model. */
export function curveUnder(view: SketchPickContext, e: MouseEvent, reach = 6): number | null {
  const rect = view.renderer.domElement.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  view.camera.updateMatrixWorld();
  let best: number | null = null;
  let bestD = reach; // pixels
  const point = (x: number, y: number, z: number) => {
    const n = new THREE.Vector3(x, y, z).project(view.camera);
    return { x: ((n.x + 1) / 2) * rect.width, y: ((1 - n.y) / 2) * rect.height, behind: n.z > 1 };
  };
  for (const { id, object } of view.curveTargets()) {
    const p = object.geometry.getAttribute("position");
    for (let i = 0; i + 1 < p.count; i += 2) {
      const a = point(p.getX(i), p.getY(i), p.getZ(i));
      const b = point(p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1));
      if (a.behind || b.behind) continue;
      const d = projectOnSegment(px, py, a.x, a.y, b.x, b.y).dist;
      if (d < bestD) {
        best = id;
        bestD = d;
      }
    }
  }
  return best;
}

export function profileUnder(view: SketchPickContext, e: PointerEvent): { id: number; region: number } | null {
  const targets = view.profileTargets();
  if (!targets.length) return null;
  const rect = view.renderer.domElement.getBoundingClientRect();
  view.raycaster.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), view.camera);
  const hit = view.raycaster.intersectObjects(targets.map((t) => t.object), false)[0];
  if (!hit) return null;
  const model = view.mesh ? view.raycaster.intersectObject(view.mesh)[0] : undefined;
  if (model && !settings.seeThrough && hit.distance > model.distance * 1.001 + 1e-3) return null; // behind the model
  const target = targets.find((t) => t.object === hit.object);
  return target ? { id: target.id, region: target.region } : null;
}
