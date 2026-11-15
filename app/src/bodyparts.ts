/** The drawing data of each body of a mesh: what the viewport turns into one graphics mesh per body. Pure (no three.js). */
import type { MeshData } from "./client.ts";

/** One body's own arrays: every number is local to the body (indices count its own vertices from 0). */
export interface BodyPart {
  /** The body's stable id; null for the faces and edges that belong to no body (loose faces, sheets). */
  body: number | null;
  /** Identity of the data: the same object on a later mesh means the body's arrays did not change, so its graphics stay as they are. */
  ref: object;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  edgePositions: Float32Array;
}

/** Whether the parts are the mesh's triangles cut by body in the mesh's own order, so a triangle of part n is the mesh triangle `base + number`. */
export function partsCover(parts: readonly BodyPart[] | undefined, indexCount: number): parts is BodyPart[] {
  return !!parts && parts.reduce((n, p) => n + p.indices.length, 0) === indexCount;
}

/** The parts of a mesh in model order: the ones the mesh store kept (`mesh.parts`) or, for a whole reply, parts cut from its arrays by body (each one new). */
export function partsOf(mesh: Pick<MeshData, "positions" | "normals" | "indices" | "edgePositions" | "faces" | "edges"> & { parts?: BodyPart[] }): BodyPart[] {
  if (mesh.parts) return mesh.parts;
  const order: (number | null)[] = [];
  const faces = new Map<number | null, MeshData["faces"]>();
  const edges = new Map<number | null, MeshData["edges"]>();
  const note = (body: number | null) => {
    if (!faces.has(body)) {
      order.push(body);
      faces.set(body, []);
      edges.set(body, []);
    }
  };
  for (const f of mesh.faces) {
    const body = f.body ?? null;
    if (f.count > 0) {
      note(body);
      faces.get(body)!.push(f);
    }
  }
  for (const e of mesh.edges) {
    const body = e.body ?? null;
    if (e.count > 0) {
      note(body);
      edges.get(body)!.push(e);
    }
  }
  return order.map((body) => {
    const local = new Map<number, number>();
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    for (const f of faces.get(body)!) {
      for (let i = f.start; i < f.start + f.count; i++) {
        const global = mesh.indices[i];
        let at = local.get(global);
        if (at === undefined) {
          at = positions.length / 3;
          local.set(global, at);
          for (let k = 0; k < 3; k++) {
            positions.push(mesh.positions[global * 3 + k]);
            normals.push(mesh.normals[global * 3 + k]);
          }
        }
        indices.push(at);
      }
    }
    const lines: number[] = [];
    for (const e of edges.get(body)!) for (let i = e.start * 3; i < (e.start + e.count) * 3; i++) lines.push(mesh.edgePositions[i]);
    return { body, ref: {}, positions: Float32Array.from(positions), normals: Float32Array.from(normals), indices: Uint32Array.from(indices), edgePositions: Float32Array.from(lines) };
  });
}
