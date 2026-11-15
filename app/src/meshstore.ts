// Per-body mesh store for delta replies: keeps each body's display data and joins it into the same MeshData a full
// reply gives. Pure (no DOM, no socket). Design: docs/agent-notes/changed-bodies-design.md (option B, git 839ea14).
// Face, edge and vertex ids stay global in the core; here they are rebuilt from the per-body counts in body order.

import type { BodyPart } from "./bodyparts.ts";
import type { CentreInfo, EdgeRange, FaceRange, MeshData, VertexInfo } from "./client.ts";

/** Display data of one changed body; every number inside is local to the body (0-based). */
export interface BodyPayload {
  positions: Float32Array;
  normals: Float32Array;
  /** Triangle indices local to this body's positions. */
  indices: Uint32Array;
  edgePositions: Float32Array;
  /** `start` is local to `indices`. */
  faces: { start: number; count: number; normal: [number, number, number] | null; centroid: [number, number, number] | null }[];
  /** `start` is local to `edgePositions` (in points, like a full reply's edge starts). */
  edges: { start: number; count: number; normal: [number, number, number] | null; centre?: [number, number, number] | null }[];
  vertices: { position: [number, number, number] }[];
  /** `face` is the local face number. */
  centres: { face: number; position: [number, number, number]; axis: [number, number, number]; length?: number }[];
}

/** One body of the model, in model order. Every body is listed on every reply; only changed ones carry `data`. */
export interface DeltaBody {
  id: number;
  rev: number;
  faces: number;
  edges: number;
  vertices: number;
  /** The entry of the full reply's `bodies` list (name, bounds, material, ...). Always sent: it is small. */
  info: Record<string, any>;
  /** Present when the page does not hold this body at this rev. */
  data?: BodyPayload;
}

/** What the core sends instead of a whole mesh. `base` is the `version` of the reply this one builds on; null means
 * it builds on nothing (every body then carries `data`). */
export interface MeshDelta {
  version: number;
  base: number | null;
  bodies: DeltaBody[];
  bounds: number[];
  /** Everything else of a full reply's header (canUndo, sketches, datums, ...). */
  header: Record<string, any>;
}

interface Held {
  rev: number;
  faces: number;
  edges: number;
  vertices: number;
  data: BodyPayload;
}

export type ApplyResult = { ok: true; mesh: MeshData } | { ok: false; needFull: true; reason: string };

export class MeshStore {
  private bodies = new Map<number, Held>();
  /** Version of the last applied delta; null when the store is empty or must be refilled. */
  version: number | null = null;

  clear(): void {
    this.bodies.clear();
    this.version = null;
  }

  /** Applies a delta. On a base mismatch or a missing body the store is cleared and a full reply is needed. */
  apply(delta: MeshDelta): ApplyResult {
    if (delta.base !== null && delta.base !== this.version) return this.fail(`base ${delta.base} does not match ${this.version}`);
    const next = new Map<number, Held>();
    for (const b of delta.bodies) {
      if (b.data) {
        if (b.data.faces.length !== b.faces || b.data.edges.length !== b.edges || b.data.vertices.length !== b.vertices) return this.fail(`body ${b.id} counts do not match its data`);
        next.set(b.id, { rev: b.rev, faces: b.faces, edges: b.edges, vertices: b.vertices, data: b.data });
        continue;
      }
      const held = delta.base === null ? undefined : this.bodies.get(b.id);
      if (!held || held.rev !== b.rev || held.faces !== b.faces || held.edges !== b.edges || held.vertices !== b.vertices) return this.fail(`body ${b.id} is not held at rev ${b.rev}`);
      next.set(b.id, held);
    }
    this.bodies = next;
    this.version = delta.version;
    return { ok: true, mesh: this.join(delta) };
  }

  private fail(reason: string): ApplyResult {
    this.clear();
    return { ok: false, needFull: true, reason };
  }

  /** The MeshData a full reply would give, from the held bodies in the delta's order. */
  private join(delta: MeshDelta): MeshData {
    const held = delta.bodies.map((b) => this.bodies.get(b.id)!);
    const sum = (f: (h: Held) => number) => held.reduce((n, h) => n + f(h), 0);
    const positions = new Float32Array(sum((h) => h.data.positions.length));
    const normals = new Float32Array(sum((h) => h.data.normals.length));
    const indices = new Uint32Array(sum((h) => h.data.indices.length));
    const edgePositions = new Float32Array(sum((h) => h.data.edgePositions.length));
    const faces: FaceRange[] = [];
    const edges: EdgeRange[] = [];
    const vertices: VertexInfo[] = [];
    const centres: CentreInfo[] = [];
    let posAt = 0, idxAt = 0, edgeAt = 0, f0 = 0, e0 = 0, v0 = 0;
    held.forEach((h, solid) => {
      const d = h.data;
      const body = delta.bodies[solid].id;
      const pointBase = posAt / 3;
      positions.set(d.positions, posAt);
      normals.set(d.normals, posAt);
      for (let i = 0; i < d.indices.length; i++) indices[idxAt + i] = d.indices[i] + pointBase;
      edgePositions.set(d.edgePositions, edgeAt);
      const indexStart = idxAt;
      const edgeStart = edgeAt / 3;
      d.faces.forEach((f, i) => faces.push({ id: f0 + i, start: indexStart + f.start, count: f.count, normal: f.normal, centroid: f.centroid, solid, body }));
      d.centres.forEach((c) => centres.push({ face: f0 + c.face, position: c.position, axis: c.axis, length: c.length }));
      d.edges.forEach((e, i) => edges.push({ id: e0 + i, start: edgeStart + e.start, count: e.count, normal: e.normal, solid, body, centre: e.centre ?? null }));
      d.vertices.forEach((v, i) => vertices.push({ id: v0 + i, position: v.position, solid, body }));
      posAt += d.positions.length;
      idxAt += d.indices.length;
      edgeAt += d.edgePositions.length;
      f0 += h.faces;
      e0 += h.edges;
      v0 += h.vertices;
    });
    const bodies = delta.bodies.map((b) => b.info);
    const parts: BodyPart[] = held.map((h, i) => ({ body: delta.bodies[i].id, ref: h.data, positions: h.data.positions, normals: h.data.normals, indices: h.data.indices, edgePositions: h.data.edgePositions }));
    return {
      parts,
      header: { ...delta.header, faces, edges, vertices, centres, bodies, bounds: delta.bounds },
      positions,
      normals,
      indices,
      edgePositions,
      faces,
      edges,
      vertices,
      centres,
      bounds: delta.bounds,
    };
  }
}
