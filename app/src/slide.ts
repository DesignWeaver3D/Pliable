/** Splitting a mesh's draw lists by body, so a few bodies can be slid on the client while a move handle is dragged. */

interface Range {
  start: number;
  count: number;
  body?: number | null;
}

/** Split `source` (`unit` numbers per element) into the elements of the ranges `moves` accepts and everything else. */
function split(ranges: Range[], unit: number, source: ArrayLike<number>, moves: (r: Range) => boolean) {
  const moving: number[] = [];
  const rest: number[] = [];
  let at = 0;
  for (const range of [...ranges].filter((r) => r.count > 0).sort((a, b) => a.start - b.start)) {
    const from = range.start * unit;
    const to = (range.start + range.count) * unit;
    for (let i = at; i < from; i++) rest.push(source[i]); // anything outside every range stays put
    const into = moves(range) ? moving : rest;
    for (let i = from; i < to; i++) into.push(source[i]);
    at = to;
  }
  for (let i = at; i < source.length; i++) rest.push(source[i]);
  return { moving, rest };
}

/** The triangle indices and edge segments of a mesh split into those of `bodies` and the rest; null when none of the bodies has any. */
export function splitDrawLists(data: { indices: ArrayLike<number>; edgePositions: ArrayLike<number>; faces: Range[]; edges: Range[] }, bodies: Set<number>) {
  const moves = (r: Range) => r.body != null && bodies.has(r.body);
  const surface = split(data.faces, 1, data.indices, moves);
  const edges = split(data.edges, 3, data.edgePositions, moves);
  if (surface.moving.length === 0 && edges.moving.length === 0) return null;
  return {
    movingIndices: Uint32Array.from(surface.moving),
    restIndices: Uint32Array.from(surface.rest),
    movingEdges: Float32Array.from(edges.moving),
    restEdges: Float32Array.from(edges.rest),
  };
}

/** The mean position of each body's vertices (a cheap fingerprint of where a body is). */
export function bodyCentres(vertices: { body?: number | null; position: [number, number, number] }[]): Map<number, [number, number, number]> {
  const sums = new Map<number, { p: [number, number, number]; n: number }>();
  for (const v of vertices) {
    if (v.body == null) continue;
    const s = sums.get(v.body) ?? { p: [0, 0, 0] as [number, number, number], n: 0 };
    for (let i = 0; i < 3; i++) s.p[i] += v.position[i];
    s.n += 1;
    sums.set(v.body, s);
  }
  return new Map([...sums].map(([b, s]) => [b, s.p.map((c) => c / s.n) as [number, number, number]]));
}

/** The bodies whose centre moved between two meshes by a shift along `direction` (a move handle's axis); null if none did. */
export function movedBodies(before: Map<number, [number, number, number]>, after: Map<number, [number, number, number]>, direction: readonly number[], eps = 1e-4): Set<number> | null {
  const moved = new Set<number>();
  for (const [body, p] of after) {
    const q = before.get(body);
    if (!q) continue;
    const d = [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
    const along = d[0] * direction[0] + d[1] * direction[1] + d[2] * direction[2];
    const across = Math.hypot(d[0] - along * direction[0], d[1] - along * direction[1], d[2] - along * direction[2]);
    if (Math.abs(along) > eps && across < Math.abs(along) * 0.01 + eps) moved.add(body);
  }
  return moved.size ? moved : null;
}
