/** Finding the bodies that slide on the client while a move handle is dragged. */

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

/** The bodies whose center moved between two meshes by a shift along `direction` (a move handle's axis); null if none did. With `expected`, only bodies that moved by that distance count. */
export function movedBodies(before: Map<number, [number, number, number]>, after: Map<number, [number, number, number]>, direction: readonly number[], eps = 1e-4, expected?: number): Set<number> | null {
  const moved = new Set<number>();
  for (const [body, p] of after) {
    const q = before.get(body);
    if (!q) continue;
    const d = [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
    const along = d[0] * direction[0] + d[1] * direction[1] + d[2] * direction[2];
    const across = Math.hypot(d[0] - along * direction[0], d[1] - along * direction[1], d[2] - along * direction[2]);
    // A body that moves with the arrow shifts by exactly the arrow's travel; a body that only has a feature (a hole) moving shifts its mean by a fraction of it.
    if (expected !== undefined && Math.abs(along - expected) > Math.abs(expected) * 0.02 + eps) continue;
    if (Math.abs(along) > eps && across < Math.abs(along) * 0.01 + eps) moved.add(body);
  }
  return moved.size ? moved : null;
}
