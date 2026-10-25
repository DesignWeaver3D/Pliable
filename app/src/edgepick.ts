// Picking an edge as the pivot of a tool (Face Draft's Pick axis): the point of the edge the neutral plane goes through.

export interface EdgeLine {
  id: number;
  start: number;
  count: number;
}

/** The point halfway along an edge's drawn line (its middle for a straight edge), or null for an unknown or empty edge. */
export function edgeMiddle(edges: EdgeLine[], edgePositions: ArrayLike<number>, id: number): number[] | null {
  const edge = edges.find((e) => e.id === id);
  if (!edge || edge.count < 2) return null;
  const at = (i: number): number[] => [edgePositions[(edge.start + i) * 3], edgePositions[(edge.start + i) * 3 + 1], edgePositions[(edge.start + i) * 3 + 2]];
  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i + 1 < edge.count; i++) {
    const a = at(i);
    const b = at(i + 1);
    total += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    lengths.push(total);
  }
  let left = total / 2;
  for (let i = 0; i < lengths.length; i++) {
    const segment = lengths[i] - (i ? lengths[i - 1] : 0);
    if (left <= segment || i === lengths.length - 1) {
      const a = at(i);
      const b = at(i + 1);
      const t = segment > 0 ? Math.min(1, left / segment) : 0;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    }
    left -= segment;
  }
  return null;
}
