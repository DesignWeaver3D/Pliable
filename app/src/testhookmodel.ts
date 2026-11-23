/** The model half of the development-only test hook (testhook.ts): the 3D view's selection, hover and picking as data, and where a
 *  face can be clicked. It only reads, and it asks the view's own pick what is under a place on screen, so it agrees with a real click. */
import * as THREE from "three";
import type { ScreenPoint } from "./testhook.ts";
import type { Sel, Viewport } from "./viewport.ts";

/** What the page holds about the model that the hook reports. */
export interface ModelState {
  readonly currentSels: Sel[];
  readonly modelHistory: { undo: boolean; redo: boolean };
}

export interface ModelInfo {
  faces: { id: number; body: number | null }[];
  /** The model's bounding box as the core sent it. */
  bounds: number[];
  selection: { kind: string; id: number }[];
  hovered: { kind: string; id: number } | null;
  canUndo: boolean;
  canRedo: boolean;
}

export interface ModelHook {
  /** The model on screen, or null before one is loaded. */
  model(): ModelInfo | null;
  /** What a click at this place in the page would pick: a face or an edge, or null over empty space. */
  pickAt(x: number, y: number): { kind: string; id: number } | null;
  /** A place in the page where a click picks this face, or null when no part of it can be clicked (hidden, behind others, off screen). */
  faceToScreen(id: number): ScreenPoint | null;
  /** For a flat face: how far, in the page, one unit along its outward normal moves from `at` (a drag that way pulls the face out). Null for a curved face. */
  faceNormalOnScreen(id: number, at: ScreenPoint): ScreenPoint | null;
}

const item = (sel: Sel | null) => (sel ? { kind: sel.kind, id: sel.id } : null);

export function createModelHook(viewport: Viewport, state: ModelState): ModelHook {
  const pickAt = (x: number, y: number) => item(viewport.pickModelItem({ clientX: x, clientY: y, altKey: false } as PointerEvent));
  const toScreen = (world: THREE.Vector3): ScreenPoint => {
    const box = viewport.renderer.domElement.getBoundingClientRect();
    const ndc = world.clone().project(viewport.camera);
    return { x: box.left + ((ndc.x + 1) / 2) * box.width, y: box.top + ((1 - ndc.y) / 2) * box.height };
  };
  return {
    pickAt,
    model() {
      const data = viewport.data;
      if (!data) return null;
      return {
        faces: data.faces.map((f) => ({ id: f.id, body: f.body ?? null })),
        bounds: [...data.bounds],
        selection: state.currentSels.map((s) => ({ kind: s.kind, id: s.id })),
        hovered: item(viewport.hovered),
        canUndo: state.modelHistory.undo,
        canRedo: state.modelHistory.redo,
      };
    },
    faceToScreen(id) {
      const data = viewport.data;
      const face = data?.faces.find((f) => f.id === id);
      if (!data || !face) return null;
      const corner = (k: number) => new THREE.Vector3().fromArray(data.positions, data.indices[k] * 3);
      const box = viewport.renderer.domElement.getBoundingClientRect();
      for (let k = face.start; k + 2 < face.start + face.count; k += 3) {
        const at = toScreen(corner(k).add(corner(k + 1)).add(corner(k + 2)).divideScalar(3)); // the middle of one triangle of the face
        if (at.x < box.left || at.x > box.right || at.y < box.top || at.y > box.bottom) continue;
        const picked = pickAt(at.x, at.y);
        if (picked?.kind === "face" && picked.id === id) return at;
      }
      return null;
    },
    faceNormalOnScreen(id, at) {
      const normal = viewport.data?.faces.find((f) => f.id === id)?.normal;
      if (!normal) return null;
      // The place under `at` on the model, then one unit along the face's normal from there.
      const box = viewport.renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((at.x - box.left) / box.width) * 2 - 1, -((at.y - box.top) / box.height) * 2 + 1);
      viewport.raycaster.setFromCamera(ndc, viewport.camera);
      const hit = viewport.mesh ? viewport.raycaster.intersectObject(viewport.mesh, true)[0] : undefined;
      if (!hit) return null;
      const tip = toScreen(hit.point.clone().add(new THREE.Vector3(...normal)));
      return { x: tip.x - at.x, y: tip.y - at.y };
    },
  };
}
