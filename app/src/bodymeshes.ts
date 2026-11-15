/** What is drawn of the model: one surface mesh, one edge line object and (for a surface body) one back-side mesh per body.
 * A body whose part (`BodyPart.ref`) is the same one as before keeps its graphics, so a reply that changes a few bodies uploads
 * only those; the rest of the model is not touched. Picking and numbering use the merged arrays of the viewport, not these. */
import * as THREE from "three";
import type { BodyPart } from "./bodyparts.ts";
import { bodyColor } from "./bodycolors.ts";

/** Neutral surface color of faces that belong to no body (the same as the merged mesh's loose faces had). */
const NEUTRAL = new THREE.Color(0x9db4cc);

export interface BodyMaterials {
  surface: THREE.Material;
  ghost: THREE.Material | null;
  edge: THREE.Material | null;
  /** The materials of the back side (see viewback.ts), or null when no body is a surface body. */
  back: { material: THREE.Material; ghostMaterial: THREE.Material } | null;
}

interface Entry {
  part: BodyPart;
  geometry: THREE.BufferGeometry;
  edgeGeometry: THREE.BufferGeometry;
  front: THREE.Mesh;
  edges: THREE.LineSegments;
  back: THREE.Mesh | null;
}

/** One color per vertex: the body's own color, the neutral one for faces without a body. */
export function partColors(part: Pick<BodyPart, "body" | "positions">): Float32Array {
  const color = part.body == null ? NEUTRAL : new THREE.Color(bodyColor(part.body));
  const out = new Float32Array(part.positions.length);
  for (let i = 0; i < out.length; i += 3) color.toArray(out, i);
  return out;
}

export class BodyMeshes {
  private readonly parent: THREE.Object3D;
  private entries = new Map<object, Entry>();
  private materials: BodyMaterials | null = null;

  constructor(parent: THREE.Object3D) {
    this.parent = parent;
  }

  /** Number of bodies drawn. */
  get size() {
    return this.entries.size;
  }

  /** The bodies whose part was not held before (their graphics were built by the last `update`). */
  built: number[] = [];

  /** Show these parts: new parts get graphics, parts no longer listed lose them, a part seen before keeps them. Positions go back to the model's. */
  update(parts: readonly BodyPart[], materials: BodyMaterials, surfaceBodies: ReadonlySet<number>, ghosted: ReadonlySet<number>) {
    const next = new Map<object, Entry>();
    this.materials = materials;
    this.built = [];
    for (const part of parts) {
      if (part.positions.length === 0 && part.edgePositions.length === 0) continue;
      let entry = this.entries.get(part.ref);
      if (entry) this.entries.delete(part.ref);
      else {
        entry = this.build(part, materials);
        this.built.push(part.body ?? -1);
      }
      next.set(part.ref, entry);
    }
    for (const gone of this.entries.values()) this.remove(gone);
    this.entries = next;
    for (const entry of next.values()) this.place(entry, materials, surfaceBodies, ghosted);
  }

  /** Switch the see-through bodies without rebuilding anything. */
  setGhosted(ghosted: ReadonlySet<number>) {
    const materials = this.materials;
    if (materials) for (const entry of this.entries.values()) this.material(entry, materials, ghosted);
  }

  /** The surface meshes of the bodies that are not see-through (what a solid model hides behind it). */
  solidMeshes(ghosted: ReadonlySet<number>): THREE.Mesh[] {
    return [...this.entries.values()].filter((e) => e.part.body == null || !ghosted.has(e.part.body)).map((e) => e.front);
  }

  /** Shift the given bodies by `offset` from where the model has them (null: shift none, every body back in place). */
  slide(bodies: ReadonlySet<number> | null, offset: readonly [number, number, number] = [0, 0, 0]) {
    for (const e of this.entries.values()) {
      const moves = bodies !== null && e.part.body != null && bodies.has(e.part.body);
      for (const o of [e.front, e.edges, e.back]) if (o) moves ? o.position.set(...offset) : o.position.set(0, 0, 0);
    }
  }

  private build(part: BodyPart, materials: BodyMaterials): Entry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(part.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(part.normals, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(partColors(part), 3));
    geometry.setIndex(new THREE.BufferAttribute(part.indices, 1));
    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute("position", new THREE.BufferAttribute(part.edgePositions, 3));
    const front = new THREE.Mesh(geometry, materials.surface);
    front.raycast = () => {}; // picking uses the merged arrays of the viewport
    const edges = new THREE.LineSegments(edgeGeometry, materials.edge ?? undefined);
    edges.raycast = () => {};
    this.parent.add(front, edges);
    return { part, geometry, edgeGeometry, front, edges, back: null };
  }

  private remove(entry: Entry) {
    this.parent.remove(entry.front, entry.edges);
    if (entry.back) this.parent.remove(entry.back);
    entry.geometry.dispose();
    entry.edgeGeometry.dispose();
  }

  private place(entry: Entry, materials: BodyMaterials, surfaceBodies: ReadonlySet<number>, ghosted: ReadonlySet<number>) {
    entry.edges.material = materials.edge ?? entry.edges.material;
    const surface = entry.part.body != null && surfaceBodies.has(entry.part.body) && materials.back !== null && entry.part.indices.length > 0;
    if (surface && !entry.back) {
      entry.back = new THREE.Mesh(entry.geometry, materials.back!.material);
      entry.back.raycast = () => {};
      this.parent.add(entry.back);
    } else if (!surface && entry.back) {
      this.parent.remove(entry.back);
      entry.back = null;
    }
    for (const o of [entry.front, entry.edges, entry.back]) o?.position.set(0, 0, 0);
    this.material(entry, materials, ghosted);
  }

  private material(entry: Entry, materials: BodyMaterials, ghosted: ReadonlySet<number>) {
    const ghost = entry.part.body != null && ghosted.has(entry.part.body) && materials.ghost !== null;
    entry.front.material = ghost ? materials.ghost! : materials.surface;
    if (entry.back && materials.back) entry.back.material = ghost ? materials.back.ghostMaterial : materials.back.material;
  }

  /** Remove everything (a new viewport mesh set replaces all). */
  clear() {
    for (const e of this.entries.values()) this.remove(e);
    this.entries.clear();
  }
}
