import test from "node:test";
import assert from "node:assert/strict";
import { buildTriangleTree, rayTriangle } from "../src/trianglebvh.ts";

/** A repeatable random number source, so a failure can be reproduced. */
function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Every triangle the ray hits, by testing them all. */
function bruteForce(positions, indices, o, d, facing) {
  const hits = [];
  for (let t = 0; t < indices.length / 3; t++) {
    const [a, b, c] = [indices[t * 3] * 3, indices[t * 3 + 1] * 3, indices[t * 3 + 2] * 3];
    const at = rayTriangle(o[0], o[1], o[2], d[0], d[1], d[2], positions[a], positions[a + 1], positions[a + 2], positions[b], positions[b + 1], positions[b + 2], positions[c], positions[c + 1], positions[c + 2], facing);
    if (at >= 0) hits.push([t, at]);
  }
  return hits.sort((x, y) => x[0] - y[0]);
}

function treeHits(tree, o, d, facing) {
  const hits = [];
  tree.raycast(o[0], o[1], o[2], d[0], d[1], d[2], facing, (triangle, t) => hits.push([triangle, t]));
  return hits.sort((x, y) => x[0] - y[0]);
}

/** A flat grid of squares, two triangles each, in the plane z = height: like a large flat face. */
function grid(n, height, positions, indices) {
  const base = positions.length / 3;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) positions.push(i, j, height);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = base + j * (n + 1) + i;
      indices.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1);
    }
  }
}

test("a ray through a triangle reports where it meets it, by side", () => {
  const args = [0, 0, 0, 1, 0, 0, 0, 1, 0]; // counter-clockwise seen from +z
  assert.equal(rayTriangle(0.2, 0.2, 5, 0, 0, -1, ...args, "both"), 5);
  assert.equal(rayTriangle(0.2, 0.2, 5, 0, 0, -1, ...args, "front"), 5);
  assert.equal(rayTriangle(0.2, 0.2, 5, 0, 0, -1, ...args, "back"), -1);
  assert.equal(rayTriangle(0.2, 0.2, -5, 0, 0, 1, ...args, "front"), -1);
  assert.equal(rayTriangle(0.2, 0.2, -5, 0, 0, 1, ...args, "back"), 5);
  assert.equal(rayTriangle(0.2, 0.2, 5, 0, 0, 1, ...args, "both"), -1); // behind the origin
  assert.equal(rayTriangle(2, 2, 5, 0, 0, -1, ...args, "both"), -1); // beside it
  assert.equal(rayTriangle(0, 0, 5, 1, 0, 0, ...args, "both"), -1); // parallel to it
});

test("the tree finds exactly the triangles a full search finds", () => {
  const rand = random(12345);
  const positions = [];
  const indices = [];
  grid(40, 0, positions, indices); // two large flat faces
  grid(40, 3, positions, indices);
  for (let k = 0; k < 600; k++) {
    // loose triangles of mixed sizes around and between them
    const base = positions.length / 3;
    const c = [rand() * 40, rand() * 40, rand() * 6 - 1.5];
    const size = rand() < 0.1 ? 15 : 1.5;
    for (let v = 0; v < 3; v++) positions.push(c[0] + (rand() - 0.5) * size, c[1] + (rand() - 0.5) * size, c[2] + (rand() - 0.5) * size);
    indices.push(base, base + 1, base + 2);
  }
  const p = new Float32Array(positions);
  const i = new Uint32Array(indices);
  const tree = buildTriangleTree(p, i);
  assert.equal(tree.triangles, i.length / 3);
  let total = 0;
  for (let k = 0; k < 400; k++) {
    const o = [rand() * 60 - 10, rand() * 60 - 10, rand() * 30 - 10];
    const aim = [rand() * 40, rand() * 40, rand() * 5 - 1]; // a point among the triangles
    const d = k % 7 === 0 ? [0, 0, o[2] > 1.5 ? -1 : 1] : k % 11 === 0 ? [1, 0, 0] : [aim[0] - o[0], aim[1] - o[1], aim[2] - o[2]];
    for (const facing of ["both", "front", "back"]) {
      const expected = bruteForce(p, i, o, d, facing);
      assert.deepEqual(treeHits(tree, o, d, facing), expected, `ray ${k} ${facing}`);
      total += expected.length;
    }
  }
  assert.ok(total > 500, "the rays hit too little to prove anything");
});

test("rays that start on a face or run along a grid line are not lost", () => {
  const positions = [];
  const indices = [];
  grid(10, 0, positions, indices);
  const p = new Float32Array(positions);
  const i = new Uint32Array(indices);
  const tree = buildTriangleTree(p, i);
  for (const [o, d] of [
    [[5, 5, 4], [0, 0, -1]], // straight down onto a corner shared by several triangles
    [[5, 2.5, 0], [0, 0, -1]], // starting in the plane
    [[3, 3, 2], [0, 0, -2]],
    [[0, 0, 7], [0, 0, -1]], // the corner of the whole grid
    [[10, 10, 7], [0, 0, -1]],
  ]) {
    const expected = bruteForce(p, i, o, d, "both");
    assert.ok(expected.length > 0);
    assert.deepEqual(treeHits(tree, o, d, "both"), expected);
  }
});

test("an empty mesh and a mesh of identical triangles build and answer", () => {
  assert.deepEqual(treeHits(buildTriangleTree(new Float32Array(0), new Uint32Array(0)), [0, 0, 1], [0, 0, -1], "both"), []);
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const indices = new Uint32Array(300).map((_, k) => k % 3); // one hundred copies of one triangle
  const hits = treeHits(buildTriangleTree(positions, indices), [0.2, 0.2, 1], [0, 0, -1], "both");
  assert.equal(hits.length, 100);
});
