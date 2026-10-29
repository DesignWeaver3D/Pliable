/** Snap points of a hole or boss axis: its middle, then the two ends (the circle centers at its openings). */
export function holeAxisPoints(c: { position: number[]; axis: number[]; length?: number }): [[number, number, number], string][] {
  const mid = c.position as [number, number, number];
  const out: [[number, number, number], string][] = [[[mid[0], mid[1], mid[2]], "Hole center"]];
  if (c.length && c.length > 0) {
    const n = Math.hypot(c.axis[0], c.axis[1], c.axis[2]) || 1;
    const h = c.length / 2 / n;
    const d = [c.axis[0] * h, c.axis[1] * h, c.axis[2] * h];
    out.push([[mid[0] - d[0], mid[1] - d[1], mid[2] - d[2]], "Hole axis end"], [[mid[0] + d[0], mid[1] + d[1], mid[2] + d[2]], "Hole axis end"]);
  }
  return out;
}
