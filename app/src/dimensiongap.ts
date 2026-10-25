/** Cutting a dimension's own lines around its value: the part of a segment inside the padded, possibly turned, rectangle of the text is left out.
 *  Nothing else is hidden; the text keeps its own outline. No DOM. */
export interface Pt {
  x: number;
  y: number;
}

/** The pieces of segment a-b that lie outside the rectangle of half size (halfW, halfH) centred at `centre` and turned by `angleDeg`. Pieces shorter than a pixel are dropped. */
export function gapSegment(a: Pt, b: Pt, centre: Pt, halfW: number, halfH: number, angleDeg: number): [Pt, Pt][] {
  const turn = (angleDeg * Math.PI) / 180;
  const [cos, sin] = [Math.cos(turn), Math.sin(turn)];
  // The segment in the rectangle's own frame, where the rectangle is axis-aligned.
  const local = (p: Pt) => ({ x: (p.x - centre.x) * cos + (p.y - centre.y) * sin, y: -(p.x - centre.x) * sin + (p.y - centre.y) * cos });
  const [p, q] = [local(a), local(b)];
  let [t0, t1] = [0, 1];
  for (const [from, to, half] of [[p.x, q.x, halfW], [p.y, q.y, halfH]] as const) {
    const d = to - from;
    if (Math.abs(d) < 1e-12) {
      if (Math.abs(from) > half) return [[a, b]]; // parallel to this side and outside it
      continue;
    }
    const [u, v] = [(-half - from) / d, (half - from) / d];
    t0 = Math.max(t0, Math.min(u, v));
    t1 = Math.min(t1, Math.max(u, v));
  }
  if (t0 >= t1) return [[a, b]]; // never inside
  const at = (t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const pieces: [Pt, Pt][] = [];
  if (t0 * length >= 1) pieces.push([a, at(t0)]);
  if ((1 - t1) * length >= 1) pieces.push([at(t1), b]);
  return pieces;
}
