/** A tree of boxes over the triangles of a mesh, so a ray is tested against the few triangles near it instead of all of them. */

/** Which triangles a ray may hit: both sides, only those facing the ray's origin (front), or only those facing away (back). */
export type Facing = "both" | "front" | "back";

export interface TriangleTree {
  /** Calls `visit` with the number of each triangle the ray hits and the distance along the ray (in units of the direction's length), in no particular order. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, facing: Facing, visit: (triangle: number, t: number) => void): void;
  readonly triangles: number;
}

const LEAF = 8; // triangles in a box that is not divided further

/**
 * Where the ray origin + t * direction meets the triangle a, b, c (t >= 0), or -1 when it misses. A triangle is "front"
 * when its corners run counter-clockwise seen from the ray's origin. The edges of the triangle count as hits.
 */
export function rayTriangle(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number,
  facing: Facing,
): number {
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (det === 0 || (facing === "front" && det < 0) || (facing === "back" && det > 0)) return -1;
  const sx = ox - ax, sy = oy - ay, sz = oz - az;
  const u = (sx * px + sy * py + sz * pz) / det;
  if (!(u >= 0 && u <= 1)) return -1;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = (dx * qx + dy * qy + dz * qz) / det;
  if (!(v >= 0 && u + v <= 1)) return -1;
  const t = (e2x * qx + e2y * qy + e2z * qz) / det;
  return t >= 0 ? t : -1;
}

/** Build the tree for an indexed triangle list (`positions` holds x, y, z per corner; `indices` three corners per triangle). */
export function buildTriangleTree(positions: ArrayLike<number>, indices: ArrayLike<number>): TriangleTree {
  const count = Math.floor(indices.length / 3);
  const boxes = new Float32Array(count * 6); // per triangle: min x, y, z, max x, y, z
  const centres = new Float32Array(count * 3);
  for (let t = 0; t < count; t++) {
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let k = 0; k < 3; k++) {
      const o = indices[t * 3 + k] * 3;
      const x = positions[o], y = positions[o + 1], z = positions[o + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    boxes.set([minX, minY, minZ, maxX, maxY, maxZ], t * 6);
    centres.set([(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2], t * 3);
  }
  const order = new Uint32Array(count);
  for (let t = 0; t < count; t++) order[t] = t;
  // Nodes, in arrays: the box, and either two children (left = this + 1, right stored) or a run of `order`.
  const room = 2 * count + 1; // a tree with at least one triangle per leaf has fewer nodes than this
  const nodeBox = new Float32Array(room * 6);
  const nodeRight = new Int32Array(room); // 0 for a leaf
  const nodeStart = new Uint32Array(room);
  const nodeCount = new Uint32Array(room);
  let nodes = 0;

  const build = (start: number, end: number): number => {
    const node = nodes++;
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let cMinX = Infinity, cMinY = Infinity, cMinZ = Infinity, cMaxX = -Infinity, cMaxY = -Infinity, cMaxZ = -Infinity;
    for (let i = start; i < end; i++) {
      const b = order[i] * 6;
      if (boxes[b] < minX) minX = boxes[b];
      if (boxes[b + 1] < minY) minY = boxes[b + 1];
      if (boxes[b + 2] < minZ) minZ = boxes[b + 2];
      if (boxes[b + 3] > maxX) maxX = boxes[b + 3];
      if (boxes[b + 4] > maxY) maxY = boxes[b + 4];
      if (boxes[b + 5] > maxZ) maxZ = boxes[b + 5];
      const c = order[i] * 3;
      if (centres[c] < cMinX) cMinX = centres[c];
      if (centres[c] > cMaxX) cMaxX = centres[c];
      if (centres[c + 1] < cMinY) cMinY = centres[c + 1];
      if (centres[c + 1] > cMaxY) cMaxY = centres[c + 1];
      if (centres[c + 2] < cMinZ) cMinZ = centres[c + 2];
      if (centres[c + 2] > cMaxZ) cMaxZ = centres[c + 2];
    }
    nodeBox.set([minX, minY, minZ, maxX, maxY, maxZ], node * 6);
    if (end - start <= LEAF) {
      nodeStart[node] = start;
      nodeCount[node] = end - start;
      return node;
    }
    // Divide at the middle of the longest side of the box around the triangle centers.
    const ex = cMaxX - cMinX, ey = cMaxY - cMinY, ez = cMaxZ - cMinZ;
    const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
    const middle = axis === 0 ? (cMinX + cMaxX) / 2 : axis === 1 ? (cMinY + cMaxY) / 2 : (cMinZ + cMaxZ) / 2;
    let i = start;
    let j = end - 1;
    while (i <= j) {
      if (centres[order[i] * 3 + axis] < middle) i++;
      else {
        const swap = order[i];
        order[i] = order[j];
        order[j] = swap;
        j--;
      }
    }
    if (i === start || i === end) i = (start + end) >> 1; // all centers on one side (many triangles at one spot): halve the run
    build(start, i);
    nodeRight[node] = build(i, end);
    return node;
  };
  if (count > 0) build(0, count);

  return {
    triangles: count,
    raycast(ox, oy, oz, dx, dy, dz, facing, visit) {
      if (count === 0) return;
      const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
      const stack = [0];
      while (stack.length) {
        const node = stack.pop()!;
        const b = node * 6;
        // Slab test: the part of the ray inside the box, per axis. A ray along an axis (direction part 0) gives infinities, which compare correctly; 0 * Infinity (NaN) only when the origin lies exactly on a box side, and the comparisons below then keep the box.
        let near = 0;
        let far = Infinity;
        let lo = (nodeBox[b] - ox) * ix, hi = (nodeBox[b + 3] - ox) * ix;
        if (lo > hi) [lo, hi] = [hi, lo];
        if (lo > near) near = lo;
        if (hi < far) far = hi;
        lo = (nodeBox[b + 1] - oy) * iy;
        hi = (nodeBox[b + 4] - oy) * iy;
        if (lo > hi) [lo, hi] = [hi, lo];
        if (lo > near) near = lo;
        if (hi < far) far = hi;
        lo = (nodeBox[b + 2] - oz) * iz;
        hi = (nodeBox[b + 5] - oz) * iz;
        if (lo > hi) [lo, hi] = [hi, lo];
        if (lo > near) near = lo;
        if (hi < far) far = hi;
        if (near > far * (1 + 1e-7) + 1e-7) continue; // a little slack: a flat box (a face in a plane) must not be missed by rounding
        if (nodeRight[node] === 0) {
          for (let i = nodeStart[node], end = i + nodeCount[node]; i < end; i++) {
            const triangle = order[i];
            const a = indices[triangle * 3] * 3, c1 = indices[triangle * 3 + 1] * 3, c2 = indices[triangle * 3 + 2] * 3;
            const t = rayTriangle(
              ox, oy, oz, dx, dy, dz,
              positions[a], positions[a + 1], positions[a + 2],
              positions[c1], positions[c1 + 1], positions[c1 + 2],
              positions[c2], positions[c2 + 1], positions[c2 + 2],
              facing,
            );
            if (t >= 0) visit(triangle, t);
          }
        } else {
          stack.push(node + 1, nodeRight[node]);
        }
      }
    },
  };
}
