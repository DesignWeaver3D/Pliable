/** The Stretch band, shaded on the part: the region of the rubber faces that will deform, drawn as a translucent layer over those faces and
 *  clipped to the band's two ends. Shown while the tool's band handle is shown (the handle's `strip` field). */
import * as THREE from "three";
import type { HandleInfo } from "./tools.ts";

export type Strip = NonNullable<HandleInfo["strip"]>;

/** The two clipping planes that keep what lies between the strip's start and its far end (a point is kept when it is on the positive side of both). */
export function stripPlanes(strip: Pick<Strip, "origin" | "direction" | "length" | "moved">): [THREE.Plane, THREE.Plane] {
  const along = new THREE.Vector3(...strip.direction).normalize();
  const start = new THREE.Vector3(...strip.origin);
  // While the protected end is moved, the near plane goes with it; the far plane stays where the band starts.
  const first = strip.moved
    ? new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(...strip.moved[1]).normalize(), new THREE.Vector3(...strip.moved[0]))
    : new THREE.Plane(along.clone(), -along.dot(start));
  const last = new THREE.Plane(along.clone().negate(), along.dot(start) + strip.length);
  return [first, last];
}

/** The triangle indices (a slice of the mesh's index) of the listed faces; faces the mesh does not have are left out. */
export function stripIndices(faces: readonly { id: number; start: number; count: number }[], index: ArrayLike<number>, ids: readonly number[]): Uint32Array {
  const wanted = new Set(ids);
  const ranges = faces.filter((f) => wanted.has(f.id));
  const out = new Uint32Array(ranges.reduce((n, f) => n + f.count, 0));
  let to = 0;
  for (const f of ranges) for (let i = 0; i < f.count; i++) out[to++] = index[f.start + i];
  return out;
}

export class BandStrip {
  private readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private strip: Strip | null = null;
  private readonly parent: THREE.Object3D;

  constructor(parent: THREE.Object3D) {
    this.parent = parent;
    this.mesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0x4fc3f7,
        opacity: 0.35,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
    this.mesh.visible = false;
    this.mesh.renderOrder = 2;
    this.mesh.raycast = () => {}; // never picked: it is only a shading
  }

  /** Shade this strip (null: none). Remembered, so a new mesh shows it again (see `refresh`). */
  set(strip: Strip | null) {
    this.strip = strip;
  }

  /** Draw the remembered strip over the faces of the mesh now shown (`source` holds the shared positions). */
  refresh(source: THREE.BufferGeometry | null, mesh: THREE.Mesh | null, faces: readonly { id: number; start: number; count: number }[] | undefined) {
    const strip = this.strip;
    const index = mesh?.geometry.getIndex();
    if (!strip || !source || !index || !faces) {
      this.mesh.visible = false;
      return;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", source.getAttribute("position"));
    geometry.setIndex(new THREE.BufferAttribute(stripIndices(faces, index.array, strip.faces), 1));
    this.mesh.geometry.dispose();
    this.mesh.geometry = geometry;
    this.mesh.material.clippingPlanes = stripPlanes(strip);
    this.mesh.visible = true;
    if (this.mesh.parent !== this.parent) this.parent.add(this.mesh);
  }

  /** The mesh was replaced (the old one took this child with it). */
  detach() {
    this.parent.remove(this.mesh);
    this.mesh.visible = false;
  }
}
