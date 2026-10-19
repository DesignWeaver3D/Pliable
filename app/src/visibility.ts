// Hide / isolate bodies: the viewport gets a copy of the mesh without the hidden bodies.
// Face, edge and vertex ids are unchanged, so selection and tools keep working on visible items.
// Bodies are told apart by their stable id (not the solid's position), so hidden bodies stay hidden through operations.

import type { MeshData } from "./client";
import type { BodyInfo } from "./bodylist";

/** The bodies of a mesh in creation order. */
export function bodiesOf(mesh: MeshData): BodyInfo[] {
  return (mesh.header.bodies as BodyInfo[] | undefined) ?? [];
}

const isHidden = (hidden: ReadonlySet<number>, body: number | null | undefined) => body != null && hidden.has(body);

export function filterHidden(mesh: MeshData, hidden: ReadonlySet<number>): MeshData {
  if (hidden.size === 0) return mesh;
  const indices: number[] = [];
  const faces = mesh.faces.map((f) => {
    const start = indices.length;
    if (!isHidden(hidden, f.body)) for (let i = f.start; i < f.start + f.count; i++) indices.push(mesh.indices[i]);
    return { ...f, start, count: indices.length - start };
  });
  const positions: number[] = [];
  const edges = mesh.edges.map((e) => {
    const start = positions.length / 3;
    if (!isHidden(hidden, e.body)) for (let i = e.start * 3; i < (e.start + e.count) * 3; i++) positions.push(mesh.edgePositions[i]);
    return { ...e, start, count: positions.length / 3 - start };
  });
  return {
    ...mesh,
    indices: new Uint32Array(indices),
    edgePositions: new Float32Array(positions),
    faces,
    edges,
    vertices: mesh.vertices.filter((v) => !isHidden(hidden, v.body)),
  };
}
