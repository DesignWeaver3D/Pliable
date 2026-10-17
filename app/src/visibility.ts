// Hide / isolate bodies: the viewport gets a copy of the mesh without the hidden solids.
// Face, edge and vertex ids are unchanged, so selection and tools keep working on visible items.

import type { MeshData } from "./client";

/** Solid numbers present in a mesh. */
export function solidsOf(mesh: MeshData): number[] {
  return [...new Set(mesh.faces.map((f) => f.solid ?? 0))].sort((a, b) => a - b);
}

export function filterHidden(mesh: MeshData, hidden: ReadonlySet<number>): MeshData {
  if (hidden.size === 0) return mesh;
  const indices: number[] = [];
  const faces = mesh.faces.map((f) => {
    const start = indices.length;
    if (!hidden.has(f.solid ?? 0)) for (let i = f.start; i < f.start + f.count; i++) indices.push(mesh.indices[i]);
    return { ...f, start, count: indices.length - start };
  });
  const positions: number[] = [];
  const edges = mesh.edges.map((e) => {
    const start = positions.length / 3;
    if (!hidden.has(e.solid ?? 0)) for (let i = e.start * 3; i < (e.start + e.count) * 3; i++) positions.push(mesh.edgePositions[i]);
    return { ...e, start, count: positions.length / 3 - start };
  });
  return {
    ...mesh,
    indices: new Uint32Array(indices),
    edgePositions: new Float32Array(positions),
    faces,
    edges,
    vertices: mesh.vertices.filter((v) => !hidden.has(v.solid ?? 0)),
  };
}
