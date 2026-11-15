// Turns a binary reply frame into a MeshData, for connections that take delta replies (core/src/pliable/meshdelta.py):
// a delta frame is applied to the MeshStore and joined; a whole frame is decoded as before and empties the store.

import { ghostOf } from "./ghostbuffers.ts";
import { decodeMesh, type MeshData } from "./client.ts";
import type { BodyPayload, DeltaBody, MeshDelta, MeshStore } from "./meshstore.ts";

export type FrameResult = { mesh: MeshData } | { needFull: string };

const SHARED = ["positions", "normals", "indices", "edgePositions"] as const;

/** The delta of a frame: the core gives each changed body's arrays as [start, length] of the frame's four shared buffers. */
export function deltaOf(header: Record<string, any>, arrays: Record<string, Float32Array | Uint32Array>): MeshDelta {
  const bodies: DeltaBody[] = header.delta.bodies.map((b: any) => {
    const out: DeltaBody = { id: b.id, rev: b.rev, faces: b.faces, edges: b.edges, vertices: b.vertices, info: b.info };
    if (b.data) {
      // a copy: one body must not keep the whole frame alive
      const cut = (name: (typeof SHARED)[number]) => (arrays[name] as any).slice(b.data[name][0], b.data[name][0] + b.data[name][1]);
      out.data = {
        positions: cut("positions") as Float32Array,
        normals: cut("normals") as Float32Array,
        indices: cut("indices") as Uint32Array,
        edgePositions: cut("edgePositions") as Float32Array,
        faces: b.data.faces,
        edges: b.data.edges,
        vertices: b.data.vertices,
        centres: b.data.centres,
      } as BodyPayload;
    }
    return out;
  });
  const { delta, buffers, bounds, ...rest } = header;
  return { version: delta.version, base: delta.base, bodies, bounds, header: rest };
}

/** Reads a mesh frame. With `store` null the connection takes whole frames only (the frame is read as before). */
export function readFrame(frame: ArrayBuffer, store: MeshStore | null): FrameResult {
  if (!store) return { mesh: decodeMesh(frame) };
  const headerLength = new DataView(frame).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(frame, 4, headerLength)));
  if (!header.delta) {
    store.clear(); // a whole frame: the core holds nothing of this connection's page any more
    return { mesh: decodeMesh(frame) };
  }
  const base = 4 + headerLength;
  const arrays: Record<string, Float32Array | Uint32Array> = {};
  for (const b of header.buffers) arrays[b.name] = new (b.dtype === "f32" ? Float32Array : Uint32Array)(frame, base + b.offset, b.length);
  const applied = store.apply(deltaOf(header, arrays));
  if (!applied.ok) return { needFull: applied.reason };
  applied.mesh.ghost = ghostOf(header, arrays);
  return { mesh: applied.mesh };
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => sameValue((a as any)[k], (b as any)[k]));
}

function sameBytes(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** What differs between a mesh joined from deltas and a whole reply of the same model, or null when they are equal. */
export function compareMeshes(joined: MeshData, whole: MeshData): string | null {
  for (const name of ["faces", "edges", "vertices", "centres", "bounds"] as const) if (!sameValue(joined[name], whole[name])) return name;
  if (!sameValue(joined.header.bodies, whole.header.bodies)) return "bodies";
  for (const name of SHARED) if (!sameBytes(joined[name], whole[name])) return name;
  return null;
}
