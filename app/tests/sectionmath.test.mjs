// Run with: node --test app/tests
import test from "node:test";
import assert from "node:assert/strict";
import { frameOf, gridFor, hatchLines, hatchStyle, loopArea, overlapOf, regionsOf, sliceBodies, stitchLoops } from "../src/sectionmath.ts";

/** A box from (x, y, z) of the given size as a shared-vertex triangle mesh (one face range for the whole box). */
function box(x, y, z, s) {
  const positions = [];
  for (let i = 0; i < 8; i++) positions.push(x + (i & 1 ? s : 0), y + (i & 2 ? s : 0), z + (i & 4 ? s : 0));
  const quads = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
  const indices = quads.flatMap(([a, b, c, d]) => [a, b, c, a, c, d]);
  return { positions, indices };
}

function merge(...boxes) {
  const positions = [];
  const indices = [];
  const faces = [];
  boxes.forEach((b, body) => {
    const base = positions.length / 3;
    positions.push(...b.positions);
    faces.push({ start: indices.length, count: b.indices.length, body });
    indices.push(...b.indices.map((i) => i + base));
  });
  return { positions, indices, faces };
}

const planeZ = (z) => frameOf({ origin: [0, 0, z], normal: [0, 0, 1] });

test("a plane through a box gives one closed outline of the box's cross section", () => {
  const m = merge(box(0, 0, 0, 10));
  const cut = sliceBodies(m.positions, m.indices, m.faces, planeZ(4), 1e-6);
  assert.equal(cut.size, 1);
  const loops = cut.get(0);
  assert.equal(loops.length, 1);
  assert.ok(Math.abs(Math.abs(loopArea(loops[0])) - 100) < 1e-6);
});

test("a plane that misses the box gives nothing, and one lying in a face gives nothing twice over", () => {
  const m = merge(box(0, 0, 0, 10));
  assert.equal(sliceBodies(m.positions, m.indices, m.faces, planeZ(20), 1e-6).size, 0);
  const onFace = sliceBodies(m.positions, m.indices, m.faces, planeZ(10), 1e-6);
  for (const loops of onFace.values()) for (const l of loops) assert.ok(Math.abs(loopArea(l)) < 1e-6 || Math.abs(Math.abs(loopArea(l)) - 100) < 1e-6);
});

test("each body gets its own outlines", () => {
  const m = merge(box(0, 0, 0, 10), box(20, 0, 0, 10));
  const cut = sliceBodies(m.positions, m.indices, m.faces, planeZ(5), 1e-6);
  assert.deepEqual([...cut.keys()].sort(), [0, 1]);
});

test("loose segments join into loops and open chains are dropped", () => {
  const square = [0, 0, 1, 0, 1, 0, 1, 1, 1, 1, 0, 1, 0, 1, 0, 0];
  assert.equal(stitchLoops(square, 1e-6).length, 1);
  assert.equal(stitchLoops([0, 0, 1, 0, 1, 0, 1, 1], 1e-6).length, 0);
  // end points off by less than the tolerance still join
  assert.equal(stitchLoops([0, 0, 1, 0, 1.0000001, 0, 1, 1, 1, 1.0000001, 0, 1, 0, 1, 0, 0], 1e-5).length, 1);
});

test("a loop inside another is a hole of it", () => {
  const outer = [0, 0, 10, 0, 10, 10, 0, 10];
  const hole = [3, 3, 3, 7, 7, 7, 7, 3];
  const island = [4, 4, 6, 4, 6, 6, 4, 6];
  const regions = regionsOf([hole, outer, island]);
  assert.equal(regions.length, 2);
  const big = regions.find((r) => r.outer === outer);
  assert.deepEqual(big.holes, [hole]);
  assert.deepEqual(regions.find((r) => r.outer === island).holes, []);
});

test("hatch lines stay inside the outline and are evenly spaced", () => {
  const square = [0, 0, 10, 0, 10, 10, 0, 10];
  const lines = hatchLines([square], 0, 2);
  assert.ok(lines.length >= 4 * 4);
  for (let i = 0; i < lines.length; i += 4) {
    assert.equal(lines[i + 1], lines[i + 3]); // horizontal
    assert.ok(Math.abs(lines[i + 2] - lines[i] - 10) < 1e-9);
  }
  const diagonal = hatchLines([square], 45, 2);
  for (let i = 0; i < diagonal.length; i++) assert.ok(diagonal[i] >= -1e-9 && diagonal[i] <= 10 + 1e-9);
});

test("hatch lines skip the hole of a ring", () => {
  const ring = [[0, 0, 10, 0, 10, 10, 0, 10], [4, 4, 4, 6, 6, 6, 6, 4]];
  const lines = hatchLines(ring, 0, 1);
  let length = 0;
  for (let i = 0; i < lines.length; i += 4) length += Math.hypot(lines[i + 2] - lines[i], lines[i + 3] - lines[i + 1]);
  assert.ok(Math.abs(length - 96) < 2.5, `length ${length}`);
});

test("neighbouring bodies in the list get different angles and spacings", () => {
  for (let r = 0; r < 20; r++) {
    const a = hatchStyle(r);
    const b = hatchStyle(r + 1);
    assert.notEqual(a.angle, b.angle);
    assert.notEqual(a.spacing, b.spacing);
  }
});

test("overlapping sections are marked and the touching ones are not", () => {
  const m = merge(box(0, 0, 0, 10), box(5, 5, 0, 10), box(30, 0, 0, 10), box(-10, 0, 0, 10));
  const cut = sliceBodies(m.positions, m.indices, m.faces, planeZ(5), 1e-6);
  const grid = gridFor([...cut.values()].flat(), 400);
  const overlap = overlapOf(cut, grid);
  const area = overlap.cells * grid.cell * grid.cell;
  assert.ok(Math.abs(area - 25) < 1.5, `area ${area}`); // 5 x 5 where the first two boxes meet; the third is apart and the fourth only touches
  assert.deepEqual([...overlap.pairs.keys()], ["0,1"]);
});

test("one body, or separate bodies, have no overlap", () => {
  const m = merge(box(0, 0, 0, 10), box(20, 0, 0, 10));
  const cut = sliceBodies(m.positions, m.indices, m.faces, planeZ(5), 1e-6);
  const overlap = overlapOf(cut, gridFor([...cut.values()].flat(), 200));
  assert.equal(overlap.cells, 0);
});
