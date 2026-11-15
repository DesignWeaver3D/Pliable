// Hide / isolate bodies: the viewport gets a copy of the mesh without the hidden bodies.
// Face, edge and vertex ids are unchanged, so selection and tools keep working on visible items.
// Bodies are told apart by their stable id (not the solid's position), so hidden bodies stay hidden through operations.

import type { MeshData } from "./client.ts";
import type { BodyInfo } from "./bodylist.ts";

/** The bodies of a mesh in creation order. */
export function bodiesOf(mesh: MeshData): BodyInfo[] {
  return (mesh.header.bodies as BodyInfo[] | undefined) ?? [];
}

const isHidden = (hidden: ReadonlySet<number>, body: number | null | undefined) => body != null && hidden.has(body);

export function filterHidden(mesh: MeshData, hidden: ReadonlySet<number>): MeshData {
  if (hidden.size === 0) return mesh;
  // Typed arrays sized first: a long model is copied in a few block moves, not pushed number by number.
  const visibleFaces = mesh.faces.filter((f) => !isHidden(hidden, f.body));
  const indices = new Uint32Array(visibleFaces.reduce((n, f) => n + f.count, 0));
  let at = 0;
  const faces = mesh.faces.map((f) => {
    const start = at;
    if (!isHidden(hidden, f.body)) {
      indices.set(mesh.indices.subarray(f.start, f.start + f.count), at);
      at += f.count;
    }
    return { ...f, start, count: at - start };
  });
  const positions = new Float32Array(mesh.edges.reduce((n, e) => n + (isHidden(hidden, e.body) ? 0 : e.count * 3), 0));
  let pointAt = 0;
  const edges = mesh.edges.map((e) => {
    const start = pointAt / 3;
    if (!isHidden(hidden, e.body)) {
      positions.set(mesh.edgePositions.subarray(e.start * 3, (e.start + e.count) * 3), pointAt);
      pointAt += e.count * 3;
    }
    return { ...e, start, count: pointAt / 3 - start };
  });
  return {
    ...mesh,
    indices,
    edgePositions: positions,
    faces,
    edges,
    vertices: mesh.vertices.filter((v) => !isHidden(hidden, v.body)),
    ...(mesh.parts ? { parts: mesh.parts.filter((p) => !isHidden(hidden, p.body)) } : {}),
  };
}

/** The index ranges of the surface in draw order, merged into runs of solid and see-through faces. */
export function ghostRuns(faces: readonly { start: number; count: number; body?: number | null }[], ghost: ReadonlySet<number>, total: number): { start: number; count: number; ghost: boolean }[] {
  const runs: { start: number; count: number; ghost: boolean }[] = [];
  const add = (start: number, count: number, g: boolean) => {
    if (count <= 0) return;
    const last = runs[runs.length - 1];
    if (last && last.ghost === g && last.start + last.count === start) last.count += count;
    else runs.push({ start, count, ghost: g });
  };
  let pos = 0;
  for (const f of [...faces].sort((a, b) => a.start - b.start)) {
    if (f.count === 0) continue;
    add(pos, f.start - pos, false); // a gap no face claims stays solid
    add(f.start, f.count, f.body != null && ghost.has(f.body));
    pos = f.start + f.count;
  }
  add(pos, total - pos, false);
  return runs;
}
