import test from "node:test";
import assert from "node:assert/strict";
import { MeshStore } from "../src/meshstore.ts";

// A body with `nf` quad faces: 4 points per face, 6 indices per face, one edge per face of 2 points, 1 vertex per face.
function payload(seed, nf) {
  const positions = new Float32Array(nf * 12).map((_, i) => seed + i);
  const indices = new Uint32Array(nf * 6);
  for (let f = 0; f < nf; f++) indices.set([0, 1, 2, 0, 2, 3].map((n) => n + f * 4), f * 6);
  return {
    positions,
    normals: new Float32Array(nf * 12).fill(seed),
    indices,
    edgePositions: new Float32Array(nf * 6).map((_, i) => seed * 10 + i),
    faces: Array.from({ length: nf }, (_, f) => ({ start: f * 6, count: 6, normal: [0, 0, seed], centroid: [f, 0, 0] })),
    edges: Array.from({ length: nf }, (_, f) => ({ start: f * 2, count: 2, normal: null, centre: null })),
    vertices: Array.from({ length: nf }, (_, f) => ({ position: [seed, f, 0] })),
    centres: [{ face: 0, position: [seed, 0, 0], axis: [0, 0, 1], length: 2 }],
  };
}

const body = (id, rev, nf, changed = true) => ({ id, rev, faces: nf, edges: nf, vertices: nf, info: { id, name: `B${id}` }, ...(changed ? { data: payload(id, nf) } : {}) });
const delta = (version, base, bodies) => ({ version, base, bodies, bounds: [0, 0, 0, 1, 1, 1], header: { canUndo: true } });
const fresh = (bodies) => {
  const r = new MeshStore().apply(delta(1, null, bodies.map((b) => ({ ...b, data: b.data ?? payload(b.id, b.faces) }))));
  assert.ok(r.ok);
  return r.mesh;
};
const same = (a, b) => assert.deepEqual({ ...a, header: undefined }, { ...b, header: undefined });

test("a first delta without a base builds the joined mesh with global ids", () => {
  const r = new MeshStore().apply(delta(1, null, [body(5, 1, 2), body(7, 1, 3)]));
  assert.ok(r.ok);
  const m = r.mesh;
  assert.deepEqual(m.faces.map((f) => f.id), [0, 1, 2, 3, 4]);
  assert.deepEqual(m.faces.map((f) => f.solid), [0, 0, 1, 1, 1]);
  assert.deepEqual(m.faces.map((f) => f.body), [5, 5, 7, 7, 7]);
  assert.equal(m.faces[2].start, 12);
  assert.equal(m.indices[12], 8); // second body's points follow the first body's 8
  assert.equal(m.edges[2].start, 4);
  assert.equal(m.vertices[4].id, 4);
  assert.equal(m.centres[1].face, 2);
  assert.equal(m.header.bodies.length, 2);
});

test("one changed body: unchanged bodies are reused and the result equals a full reply", () => {
  const s = new MeshStore();
  s.apply(delta(1, null, [body(1, 1, 2), body(2, 1, 2), body(3, 1, 2)]));
  const r = s.apply(delta(2, 1, [body(1, 1, 2, false), body(2, 2, 4), body(3, 1, 2, false)]));
  assert.ok(r.ok);
  same(r.mesh, fresh([body(1, 1, 2), body(2, 2, 4), body(3, 1, 2)]));
  assert.equal(r.mesh.faces.find((f) => f.body === 3).id, 6);
});

test("an early body deleted renumbers the later ones", () => {
  const s = new MeshStore();
  s.apply(delta(1, null, [body(1, 1, 2), body(2, 1, 3), body(3, 1, 2)]));
  const r = s.apply(delta(2, 1, [body(2, 1, 3, false), body(3, 1, 2, false)]));
  assert.ok(r.ok);
  same(r.mesh, fresh([body(2, 1, 3), body(3, 1, 2)]));
  assert.deepEqual(r.mesh.faces.map((f) => [f.id, f.solid]), [[0, 0], [1, 0], [2, 0], [3, 1], [4, 1]]);
  assert.equal(r.mesh.vertices.at(-1).id, 4);
});

test("a body added carries its data; the others are reused", () => {
  const s = new MeshStore();
  s.apply(delta(1, null, [body(1, 1, 2)]));
  const r = s.apply(delta(2, 1, [body(1, 1, 2, false), body(9, 1, 3)]));
  assert.ok(r.ok);
  same(r.mesh, fresh([body(1, 1, 2), body(9, 1, 3)]));
});

test("an unchanged reply gives the same mesh and takes the new version", () => {
  const s = new MeshStore();
  const first = s.apply(delta(1, null, [body(1, 1, 2), body(2, 1, 2)]));
  const r = s.apply(delta(2, 1, [body(1, 1, 2, false), body(2, 1, 2, false)]));
  assert.ok(r.ok && first.ok);
  same(r.mesh, first.mesh);
  assert.equal(s.version, 2);
});

test("a base mismatch asks for a full reply and clears the store", () => {
  const s = new MeshStore();
  s.apply(delta(1, null, [body(1, 1, 2)]));
  const r = s.apply(delta(5, 4, [body(1, 1, 2, false)]));
  assert.deepEqual([r.ok, r.needFull], [false, true]);
  assert.equal(s.version, null);
  assert.equal(s.apply(delta(6, 5, [body(1, 1, 2, false)])).ok, false);
});

test("an unchanged body that is not held at that rev asks for a full reply", () => {
  const s = new MeshStore();
  s.apply(delta(1, null, [body(1, 1, 2)]));
  assert.equal(s.apply(delta(2, 1, [body(1, 3, 2, false)])).ok, false);
  const t = new MeshStore();
  t.apply(delta(1, null, [body(1, 1, 2)]));
  assert.equal(t.apply(delta(2, 1, [body(1, 1, 2, false), body(2, 1, 2, false)])).ok, false);
});

test("a full reply (base null) replaces everything the store held", () => {
  const s = new MeshStore();
  s.apply(delta(1, null, [body(1, 1, 2), body(2, 1, 2)]));
  const r = s.apply(delta(7, null, [body(3, 1, 1)]));
  assert.ok(r.ok);
  assert.equal(r.mesh.faces.length, 1);
  assert.equal(s.version, 7);
});
