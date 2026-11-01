/** Construction lines stacked on one another are drawn dashed, and two dash patterns on the same stretch fill each other's gaps and look like a solid line. This cuts each line down to
 *  the stretches no shorter line already covers (the shorter one is on top), so every stretch is dashed once. No DOM. */
import type { Pt } from "./vec.ts";
type UV = Pt;
export interface StackedLine {
  a: UV;
  b: UV;
}

const EPS = 1e-6;

/** The pieces of each line that remain once the collinear shorter lines are taken out, as segments in the same order of preference (shortest line first). */
export function unstacked(lines: StackedLine[]): [UV, UV][] {
  const length = (l: StackedLine) => Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]);
  const byLength = lines.map((line, i) => ({ line, i, len: length(line) })).sort((p, q) => p.len - q.len || p.i - q.i);
  const out: [UV, UV][] = [];
  byLength.forEach(({ line, len }, k) => {
    if (len < EPS) return;
    const d: UV = [(line.b[0] - line.a[0]) / len, (line.b[1] - line.a[1]) / len];
    const along = (p: UV) => ((p[0] - line.a[0]) * d[0] + (p[1] - line.a[1]) * d[1]) / len; // 0 at a, 1 at b
    const off = (p: UV) => Math.abs((p[0] - line.a[0]) * -d[1] + (p[1] - line.a[1]) * d[0]);
    const covered: [number, number][] = [];
    for (const { line: other } of byLength.slice(0, k)) {
      if (off(other.a) > EPS * Math.max(1, len) || off(other.b) > EPS * Math.max(1, len)) continue;
      const [t0, t1] = [along(other.a), along(other.b)].sort((x, y) => x - y);
      if (t1 > 0 && t0 < 1) covered.push([Math.max(0, t0), Math.min(1, t1)]);
    }
    covered.sort((p, q) => p[0] - q[0]);
    let from = 0;
    const piece = (t0: number, t1: number) => t1 - t0 > EPS && out.push([[line.a[0] + (line.b[0] - line.a[0]) * t0, line.a[1] + (line.b[1] - line.a[1]) * t0], [line.a[0] + (line.b[0] - line.a[0]) * t1, line.a[1] + (line.b[1] - line.a[1]) * t1]]);
    for (const [t0, t1] of covered) {
      piece(from, t0);
      from = Math.max(from, t1);
    }
    piece(from, 1);
  });
  return out;
}
