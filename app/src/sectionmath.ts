/** The arithmetic of the section view (kept free of the DOM and three.js for tests): slicing a triangle mesh with a plane,
 *  joining the cut segments into loops, hatch lines inside the loops, and where the sections of different bodies overlap. */

export type V3 = [number, number, number];

/** A closed outline in the section plane's own 2D coordinates: x0, y0, x1, y1, ... (the first point is not repeated at the end). */
export type Loop = number[];

export interface SectionPlane {
  origin: V3;
  /** Unit length. */
  normal: V3;
}

export interface Frame {
  origin: V3;
  n: V3;
  u: V3;
  v: V3;
}

const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** The plane's axes: u and v lie in it, and the same normal always gives the same u and v (so a hatch pattern holds still while the plane slides along its normal). */
export function frameOf(plane: SectionPlane): Frame {
  const n = unit(plane.normal);
  const helper: V3 = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = unit(cross(helper, n));
  const v = cross(n, u);
  return { origin: plane.origin, n, u, v };
}

export interface FaceSlice {
  start: number;
  count: number;
  body?: number | null;
}

/**
 * The cut of a triangle mesh by the plane, per body (faces without a body share the key -1): closed outlines in the plane's
 * 2D coordinates. `faces` are index ranges into `indices`. A vertex exactly on the plane counts as on the side the normal
 * points to, so neighboring triangles agree and the outlines close.
 */
export function sliceBodies(positions: ArrayLike<number>, indices: ArrayLike<number>, faces: readonly FaceSlice[], frame: Frame, eps: number): Map<number, Loop[]> {
  const vertexCount = positions.length / 3;
  const dist = new Float64Array(vertexCount);
  const { origin, n, u, v } = frame;
  for (let i = 0; i < vertexCount; i++) {
    dist[i] = (positions[3 * i] - origin[0]) * n[0] + (positions[3 * i + 1] - origin[1]) * n[1] + (positions[3 * i + 2] - origin[2]) * n[2];
  }
  const segments = new Map<number, number[]>();
  const point = (a: number, b: number, out: number[]) => {
    const t = dist[a] / (dist[a] - dist[b]);
    const x = positions[3 * a] + t * (positions[3 * b] - positions[3 * a]) - origin[0];
    const y = positions[3 * a + 1] + t * (positions[3 * b + 1] - positions[3 * a + 1]) - origin[1];
    const z = positions[3 * a + 2] + t * (positions[3 * b + 2] - positions[3 * a + 2]) - origin[2];
    out.push(x * u[0] + y * u[1] + z * u[2], x * v[0] + y * v[1] + z * v[2]);
  };
  for (const face of faces) {
    let list: number[] | undefined;
    for (let k = face.start; k + 2 < face.start + face.count; k += 3) {
      const a = indices[k];
      const b = indices[k + 1];
      const c = indices[k + 2];
      const pa = dist[a] >= 0;
      const pb = dist[b] >= 0;
      const pc = dist[c] >= 0;
      if (pa === pb && pb === pc) continue;
      list ??= segments.get(face.body ?? -1) ?? [];
      // The lone vertex is the one on its own side; the segment joins the two edges leaving it.
      const [lone, p, q] = pa !== pb && pa !== pc ? [a, b, c] : pb !== pa && pb !== pc ? [b, c, a] : [c, a, b];
      point(lone, p, list);
      point(lone, q, list);
    }
    if (list) segments.set(face.body ?? -1, list);
  }
  const result = new Map<number, Loop[]>();
  for (const [body, flat] of segments) {
    const loops = stitchLoops(flat, eps);
    if (loops.length) result.set(body, loops);
  }
  return result;
}

/** Join loose segments (x0, y0, x1, y1, ...) end to end into closed loops; points closer than `eps` are one point, open chains are dropped. */
export function stitchLoops(flat: readonly number[], eps: number): Loop[] {
  const xs: number[] = [];
  const ys: number[] = [];
  const cells = new Map<string, number[]>();
  const cell = eps * 4;
  const node = (x: number, y: number): number => {
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    for (let i = cx - 1; i <= cx + 1; i++) {
      for (let j = cy - 1; j <= cy + 1; j++) {
        for (const id of cells.get(`${i},${j}`) ?? []) if (Math.abs(xs[id] - x) <= eps && Math.abs(ys[id] - y) <= eps) return id;
      }
    }
    const id = xs.length;
    xs.push(x);
    ys.push(y);
    const key = `${cx},${cy}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(id);
    else cells.set(key, [id]);
    return id;
  };
  const from: number[] = [];
  const to: number[] = [];
  for (let i = 0; i + 3 < flat.length; i += 4) {
    const a = node(flat[i], flat[i + 1]);
    const b = node(flat[i + 2], flat[i + 3]);
    if (a === b) continue;
    from.push(a);
    to.push(b);
  }
  const at: number[][] = xs.map(() => []);
  from.forEach((a, e) => {
    at[a].push(e);
    at[to[e]].push(e);
  });
  const used = new Uint8Array(from.length);
  const loops: Loop[] = [];
  for (let e0 = 0; e0 < from.length; e0++) {
    if (used[e0]) continue;
    used[e0] = 1;
    const path = [from[e0], to[e0]];
    let closed = false;
    for (;;) {
      const here = path[path.length - 1];
      const next = at[here].find((e) => !used[e]);
      if (next === undefined) break;
      used[next] = 1;
      const far = from[next] === here ? to[next] : from[next];
      if (far === path[0]) {
        closed = true;
        break;
      }
      path.push(far);
    }
    if (closed && path.length >= 3) loops.push(path.flatMap((id) => [xs[id], ys[id]]));
  }
  return loops;
}

export function loopArea(loop: Loop): number {
  let sum = 0;
  const n = loop.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += loop[2 * i] * loop[2 * j + 1] - loop[2 * j] * loop[2 * i + 1];
  }
  return sum / 2;
}

export function inLoop(loop: Loop, x: number, y: number): boolean {
  let inside = false;
  const n = loop.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = loop[2 * i + 1];
    const yj = loop[2 * j + 1];
    if (yi > y !== yj > y && x < ((loop[2 * j] - loop[2 * i]) * (y - yi)) / (yj - yi) + loop[2 * i]) inside = !inside;
  }
  return inside;
}

export interface Region {
  outer: Loop;
  holes: Loop[];
}

/** Sort loops into filled regions: a loop inside an odd number of others is a hole of the smallest loop around it. */
export function regionsOf(loops: readonly Loop[]): Region[] {
  const order = loops.map((loop, i) => ({ loop, area: Math.abs(loopArea(loop)), i })).sort((a, b) => b.area - a.area);
  const parent: number[] = [];
  const depth: number[] = [];
  order.forEach((item, k) => {
    let p = -1;
    for (let j = k - 1; j >= 0; j--) {
      if (inLoop(order[j].loop, item.loop[0], item.loop[1])) {
        p = j;
        break; // the nearest larger loop around it is the smallest one
      }
    }
    parent.push(p);
    depth.push(p < 0 ? 0 : depth[p] + 1);
  });
  const regions = new Map<number, Region>();
  order.forEach((item, k) => {
    if (depth[k] % 2 === 0) regions.set(k, { outer: item.loop, holes: [] });
  });
  order.forEach((item, k) => {
    if (depth[k] % 2 === 1) regions.get(parent[k])?.holes.push(item.loop);
  });
  return [...regions.values()];
}

/**
 * Where lines through the loops cross their edges. Line k lies at s = first + k * step, with s = -sin*x + cos*y along
 * the direction (cos, sin) and t = cos*x + sin*y the position along the line; returns each line's sorted t values
 * (pairs of them bound the inside, even-odd). A crossing counts for the edge side where s is above the line.
 */
export function scanLines(loops: readonly Loop[], cos: number, sin: number, first: number, step: number, count: number): number[][] {
  const lines: number[][] = Array.from({ length: count }, () => []);
  for (const loop of loops) {
    const n = loop.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const s0 = -sin * loop[2 * i] + cos * loop[2 * i + 1];
      const s1 = -sin * loop[2 * j] + cos * loop[2 * j + 1];
      if (s0 === s1) continue;
      const t0 = cos * loop[2 * i] + sin * loop[2 * i + 1];
      const t1 = cos * loop[2 * j] + sin * loop[2 * j + 1];
      const lo = Math.min(s0, s1);
      const hi = Math.max(s0, s1);
      // Lines with lo < s <= hi (half open, so a vertex on a line is counted once for the two edges meeting there).
      const kFrom = Math.max(0, Math.floor((lo - first) / step) + 1);
      const kTo = Math.min(count - 1, Math.floor((hi - first) / step));
      for (let k = kFrom; k <= kTo; k++) {
        const s = first + k * step;
        lines[k].push(t0 + ((s - s0) * (t1 - t0)) / (s1 - s0));
      }
    }
  }
  for (const line of lines) line.sort((a, b) => a - b);
  return lines;
}

export interface HatchStyle {
  /** Degrees. */
  angle: number;
  /** Multiplies the base distance between the lines. */
  spacing: number;
}

const ANGLES = [45, 135, 0, 90, 22.5, 112.5, 67.5, 157.5];
const SPACINGS = [1, 1.6, 2.3, 1.3];

/** The hatch of the body at this place in the list of bodies: neighbors in the list differ in both the angle and the spacing. */
export function hatchStyle(rank: number): HatchStyle {
  const r = Math.max(0, Math.floor(rank));
  return { angle: ANGLES[r % ANGLES.length], spacing: SPACINGS[(r * 3 + 1) % SPACINGS.length] };
}

/** Hatch segments (x0, y0, x1, y1, ...) inside the loops: parallel lines at `angle` degrees, `spacing` apart, held to the plane's origin. */
export function hatchLines(loops: readonly Loop[], angle: number, spacing: number, maxLines = 400): number[] {
  const a = (angle * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  let lo = Infinity;
  let hi = -Infinity;
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i += 2) {
      const s = -sin * loop[i] + cos * loop[i + 1];
      if (s < lo) lo = s;
      if (s > hi) hi = s;
    }
  }
  if (!(hi > lo)) return [];
  const step = Math.max(spacing, (hi - lo) / maxLines);
  const first = (Math.floor(lo / step) + 0.5) * step;
  const count = Math.max(0, Math.ceil((hi - first) / step));
  const out: number[] = [];
  const lines = scanLines(loops, cos, sin, first, step, count);
  lines.forEach((ts, k) => {
    const s = first + k * step;
    for (let i = 0; i + 1 < ts.length; i += 2) out.push(cos * ts[i] - sin * s, sin * ts[i] + cos * s, cos * ts[i + 1] - sin * s, sin * ts[i + 1] + cos * s);
  });
  return out;
}

export interface Grid {
  x0: number;
  y0: number;
  cell: number;
  w: number;
  h: number;
}

/** A grid of about `resolution` cells along the longer side that covers every loop. */
export function gridFor(all: readonly Loop[], resolution: number): Grid | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const loop of all) {
    for (let i = 0; i < loop.length; i += 2) {
      x0 = Math.min(x0, loop[i]);
      x1 = Math.max(x1, loop[i]);
      y0 = Math.min(y0, loop[i + 1]);
      y1 = Math.max(y1, loop[i + 1]);
    }
  }
  if (!(x1 > x0) || !(y1 > y0)) return null;
  const cell = Math.max(x1 - x0, y1 - y0) / resolution;
  return { x0, y0, cell, w: Math.ceil((x1 - x0) / cell), h: Math.ceil((y1 - y0) / cell) };
}

export interface Overlap {
  /** One byte per grid cell (row by row): 1 where the sections of two or more bodies cover the cell. */
  mask: Uint8Array;
  /** Cells covered by more than one body, and the pairs of body ids that overlap with their cell counts. */
  cells: number;
  pairs: Map<string, number>;
}

/** Rasterise each body's section on the grid and mark the cells that more than one body covers (the bodies intersect there). */
export function overlapOf(bodies: ReadonlyMap<number, readonly Loop[]>, grid: Grid): Overlap {
  const owner = new Int32Array(grid.w * grid.h).fill(-2);
  const mask = new Uint8Array(grid.w * grid.h);
  const pairs = new Map<string, number>();
  let cells = 0;
  for (const [body, loops] of bodies) {
    const rows = scanLines(loops, 1, 0, grid.y0 + grid.cell / 2, grid.cell, grid.h);
    rows.forEach((xs, j) => {
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - grid.x0) / grid.cell - 0.5));
        const i1 = Math.min(grid.w - 1, Math.ceil((xs[k + 1] - grid.x0) / grid.cell - 0.5) - 1);
        for (let i = i0; i <= i1; i++) {
          const at = j * grid.w + i;
          const other = owner[at];
          if (other === -2) owner[at] = body;
          else if (other !== body) {
            if (!mask[at]) cells++;
            mask[at] = 1;
            const key = other < body ? `${other},${body}` : `${body},${other}`;
            pairs.set(key, (pairs.get(key) ?? 0) + 1);
          }
        }
      }
    });
  }
  return { mask, cells, pairs };
}
