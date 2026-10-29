/** The red ghost of a push/pull subtract: while a drag (or typed distance) previews a cut through empty space, the core's reply carries the part of the cutting volume that is
 *  outside every body (header.ghost and the ghost buffers, docs/dev-notes.md "Push/pull modes and ghost"). It is drawn as a translucent red solid with a red outline, only
 *  during the preview: the next committed model, a cancel or a preview without it takes it away. */
import * as THREE from "three";
import type { GhostBuffers } from "./ghostbuffers.ts";

/** Pure red, about 35% opaque: distinct from the opaque section-overlap red and from the arrow red. */
export const GHOST_COLOR = 0xff0000;
export const GHOST_OPACITY = 0.35;
export const GHOST_OUTLINE_COLOR = 0xff3030;

export class SubtractGhost {
  private readonly group = new THREE.Group();

  constructor(scene: THREE.Scene) {
    this.group.renderOrder = 5;
    scene.add(this.group);
  }

  /** Show this ghost, or take the old one away (null). */
  set(ghost: GhostBuffers | null) {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      (child as THREE.Mesh).geometry?.dispose();
      ((child as THREE.Mesh).material as THREE.Material | undefined)?.dispose();
    }
    if (!ghost) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(ghost.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(ghost.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(ghost.indices, 1));
    const solid = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: GHOST_COLOR, transparent: true, opacity: GHOST_OPACITY, depthWrite: false, side: THREE.DoubleSide }));
    solid.renderOrder = 5;
    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 25), new THREE.LineBasicMaterial({ color: GHOST_OUTLINE_COLOR, transparent: true, opacity: 0.9 }));
    outline.renderOrder = 6;
    this.group.add(solid, outline);
  }
}
