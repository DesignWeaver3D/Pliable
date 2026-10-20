/** "Select similar": the faces or edges that match the one selected, found from the mesh the page already holds. */
import type { MeshData } from "./client.ts";

export type SimilarKind = "faceDirection" | "faceArea" | "edgeLength";

/** Area of a face from its triangles. */
export function faceArea(data: Pick<MeshData, "positions" | "indices">, start: number, count: number): number {
  let area = 0;
  const p = data.positions;
  for (let i = start; i + 2 < start + count; i += 3) {
    const [a, b, c] = [data.indices[i] * 3, data.indices[i + 1] * 3, data.indices[i + 2] * 3];
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return area;
}

/** Length of an edge along its polyline. */
export function edgeLength(data: Pick<MeshData, "edgePositions">, start: number, count: number): number {
  let length = 0;
  const p = data.edgePositions;
  for (let i = start; i + 1 < start + count; i++) length += Math.hypot(p[(i + 1) * 3] - p[i * 3], p[(i + 1) * 3 + 1] - p[i * 3 + 1], p[(i + 1) * 3 + 2] - p[i * 3 + 2]);
  return length;
}

const close = (a: number, b: number) => Math.abs(a - b) <= 1e-3 * Math.max(Math.abs(a), Math.abs(b)) + 1e-6;

/** Ids of the items like `id` (itself included): faces facing the same way (flat faces only), faces of equal area, or edges of equal length. */
export function similarTo(data: MeshData, kind: SimilarKind, id: number): number[] {
  if (kind === "edgeLength") {
    const own = data.edges.find((e) => e.id === id);
    if (!own) return [];
    const length = edgeLength(data, own.start, own.count);
    return data.edges.filter((e) => close(edgeLength(data, e.start, e.count), length)).map((e) => e.id);
  }
  const own = data.faces.find((f) => f.id === id);
  if (!own) return [];
  if (kind === "faceDirection") {
    const n = own.normal;
    if (!n) return [id];
    return data.faces.filter((f) => f.normal && f.normal[0] * n[0] + f.normal[1] * n[1] + f.normal[2] * n[2] > 1 - 1e-6).map((f) => f.id);
  }
  const area = faceArea(data, own.start, own.count);
  return data.faces.filter((f) => f.count > 0 && close(faceArea(data, f.start, f.count), area)).map((f) => f.id);
}
