/** Sliding bodies on the client while a move handle is dragged: the bodies are split from the mesh's draw lists and repositioned without the core. */
import * as THREE from "three";
import { splitDrawLists } from "./slide.ts";
import { applyGhost } from "./viewlook.ts";
import type { Viewport } from "./viewport.ts";

/** The part of the Viewport this file uses. */
export type SlideContext = Pick<Viewport, "data" | "edgeLines" | "edgeMaterial" | "ghostMaterial" | "ghosted" | "hemiLight" | "hoverLine" | "keyLight" | "mesh" | "model" | "moving" | "renderer" | "sectionClip" | "selectedLine" | "studioEnv" | "surfaceMaterial">;

/**
 * Show the given bodies moved by `offset` from where the current mesh has them, at once and without the core: the
 * bodies are split from the mesh's draw lists the first time (and when the set changes) and then only repositioned.
 * The next `setMesh` replaces everything, so the core's reply simply takes over.
 */
export function slideBodies(view: SlideContext, bodies: Set<number>, offset: [number, number, number]) {
  const data = view.data;
  if (!data || !view.mesh || !view.edgeLines) return;
  const same = view.moving && view.moving.data === data && view.moving.bodies.size === bodies.size && [...bodies].every((b) => view.moving!.bodies.has(b));
  if (!same) {
    unsplit(view);
    const parts = splitDrawLists(data, bodies);
    if (!parts) return;
    const rest = view.mesh.geometry;
    rest.clearGroups();
    view.mesh.material = view.surfaceMaterial!; // the draw ranges change while sliding, so ghosting waits until it ends
    rest.setIndex(new THREE.BufferAttribute(parts.restIndices, 1));
    const surfaceGeometry = new THREE.BufferGeometry();
    surfaceGeometry.setAttribute("position", rest.getAttribute("position"));
    surfaceGeometry.setAttribute("normal", rest.getAttribute("normal"));
    surfaceGeometry.setAttribute("color", rest.getAttribute("color"));
    surfaceGeometry.setIndex(new THREE.BufferAttribute(parts.movingIndices, 1));
    const surface = new THREE.Mesh(surfaceGeometry, view.surfaceMaterial!);
    view.edgeLines.geometry.setAttribute("position", new THREE.BufferAttribute(parts.restEdges, 3));
    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute("position", new THREE.BufferAttribute(parts.movingEdges, 3));
    const edges = new THREE.LineSegments(edgeGeometry, view.edgeMaterial!);
    view.model.add(surface, edges);
    view.moving = { bodies: new Set(bodies), surface, edges, data };
  }
  view.moving!.surface.position.set(...offset);
  view.moving!.edges.position.set(...offset);
}

/** Put a split mesh back together (before the split is redone for another set of bodies). */
export function unsplit(view: SlideContext) {
  const m = view.moving;
  if (!m || !view.mesh || !view.edgeLines) return;
  view.model.remove(m.surface, m.edges);
  m.surface.geometry.dispose();
  m.edges.geometry.dispose();
  view.mesh.geometry.setIndex(new THREE.BufferAttribute(m.data.indices, 1));
  view.edgeLines.geometry.setAttribute("position", new THREE.BufferAttribute(m.data.edgePositions, 3));
  view.moving = null;
  applyGhost(view);
}
