/** The look of the model's surfaces: glossy or flat, body colors, see-through mode, see-through bodies and the section clip. */
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { materialOrDefault, usesBodyColors } from "./materials.ts";
import { settings } from "./settings.ts";
import { ghostRuns } from "./visibility.ts";
import type { Viewport } from "./viewport.ts";

const GLOSS_HEMI = 0.5;
const GLOSS_KEY = 1.0;

/** The part of the Viewport this file uses. */
export type LookContext = Pick<Viewport, "data" | "edgeMaterial" | "ghostMaterial" | "ghosted" | "hemiLight" | "hoverLine" | "keyLight" | "mesh" | "model" | "moving" | "renderer" | "sectionClip" | "selectedLine" | "studioEnv" | "surfaceMaterial">;

export function syncSectionClip(view: LookContext) {
  const wanted = view.sectionClip;
  view.model.traverse((o) => {
    const material = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    for (const m of Array.isArray(material) ? material : material ? [material] : []) {
      if (m.clippingPlanes === wanted || (!wanted && !m.clippingPlanes)) continue;
      m.clippingPlanes = wanted;
      m.needsUpdate = true;
    }
  });
}

/** Surface look: semi-gloss plastic (numbers from the default material, studio reflections) or the previous flat look. */
export function applyLook(view: LookContext) {
  const m = view.surfaceMaterial;
  if (!m) return;
  if (settings.glossyLook) {
    if (!view.studioEnv) {
      const pmrem = new THREE.PMREMGenerator(view.renderer);
      view.studioEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    }
    const r = materialOrDefault(settings.material).render;
    m.roughness = r.roughness;
    m.metalness = r.metalness;
    m.clearcoat = r.clearcoat;
    m.clearcoatRoughness = r.clearcoatRoughness;
    m.envMap = view.studioEnv;
    m.envMapIntensity = r.envMapIntensity;
    view.hemiLight.intensity = GLOSS_HEMI;
    view.keyLight.intensity = GLOSS_KEY;
  } else {
    m.roughness = 0.6;
    m.metalness = 0.1;
    m.clearcoat = 0;
    m.envMap = null;
    view.hemiLight.intensity = 1.4;
    view.keyLight.intensity = 1.6;
  }
  m.needsUpdate = true;
}

/** Random body colors: the per-vertex body tint multiplies a white base; off gives the plain steel-blue surface. */
export function applyBodyColors(view: LookContext) {
  const m = view.surfaceMaterial;
  if (!m) return;
  const on = settings.randomBodyColors;
  const look = materialOrDefault(settings.material);
  const tinted = on && (!settings.glossyLook || usesBodyColors(look));
  m.vertexColors = tinted;
  m.color.set(settings.glossyLook ? (tinted ? 0xffffff : look.render.color) : tinted ? 0xffffff : 0x9db4cc);
  applyLook(view);
  m.needsUpdate = true;
  syncGhostMaterial(view);
}

/** See-through: the surface is drawn translucent and edges ignore depth so hidden ones can be seen and picked. */
export function applySeeThrough(view: LookContext) {
  const on = settings.seeThrough;
  if (view.surfaceMaterial) {
    view.surfaceMaterial.transparent = on;
    view.surfaceMaterial.opacity = on ? settings.seeThroughOpacity / 100 : 1; // faces nearly clear by default; the edges carry the shape
    view.surfaceMaterial.depthWrite = !on;
    view.surfaceMaterial.needsUpdate = true;
    syncGhostMaterial(view);
  }
  if (view.edgeMaterial) {
    view.edgeMaterial.depthTest = !on;
    view.edgeMaterial.color.set(on ? 0xdce6f2 : 0x111418); // light edges stand out on the dark background through clear faces
  }
  view.hoverLine.depthTest = view.selectedLine.depthTest = !on;
}

export function syncGhostMaterial(view: LookContext) {
  const g = view.ghostMaterial;
  const m = view.surfaceMaterial;
  if (!g || !m) return;
  g.copy(m);
  g.transparent = true;
  g.opacity = settings.seeThroughOpacity / 100;
  g.depthWrite = false;
  g.needsUpdate = true;
}

/** Split the draw ranges of the surface into solid and see-through runs (two materials, one geometry, no rebuild). */
export function applyGhost(view: LookContext) {
  const mesh = view.mesh;
  const data = view.data;
  if (!mesh || !data || view.moving) return;
  mesh.geometry.clearGroups();
  if (view.ghosted.size === 0 || !view.ghostMaterial || !view.surfaceMaterial) {
    mesh.material = view.surfaceMaterial!;
    return;
  }
  syncGhostMaterial(view);
  mesh.material = [view.surfaceMaterial, view.ghostMaterial];
  for (const run of ghostRuns(data.faces, view.ghosted, data.indices.length)) mesh.geometry.addGroup(run.start, run.count, run.ghost ? 1 : 0);
}
