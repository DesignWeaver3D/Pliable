import test from "node:test";
import assert from "node:assert/strict";
import { centroid, lineThroughPoint, reflection, repeat, rotation, scaling, splitLine, transform, translation } from "../src/sketchedit.ts";

const sketch = () => ({
  plane: { origin: [0, 0, 0], normal: [0, 0, 1], xdir: [1, 0, 0] },
  points: [{ id: 1, u: 0, v: 0 }, { id: 2, u: 4, v: 0 }, { id: 3, u: 2, v: 2 }, { id: 4, u: 2, v: 3 }, { id: 5, u: 9, v: 9, fixed: true }],
  entities: [{ id: 10, type: "line", a: 1, b: 2 }, { id: 11, type: "arc", center: 3, start: 2, end: 4 }, { id: 12, type: "line", a: 3, b: 5 }],
  constraints: [],
});
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("moving shapes shifts their points and leaves fixed reference points alone", () => {
  const { sketch: moved } = transform(sketch(), [{ kind: "entity", id: 12 }], translation(1, -1), { copy: false });
  assert.deepEqual([moved.points[2].u, moved.points[2].v], [3, 1]);
  assert.deepEqual([moved.points[4].u, moved.points[4].v], [9, 9]);
});

test("rotating a quarter turn about the middle", () => {
  const s = sketch();
  const [cu, cv] = centroid(s, [{ kind: "entity", id: 10 }]);
  const { sketch: turned } = transform(s, [{ kind: "entity", id: 10 }], rotation(90, cu, cv), { copy: false });
  near(turned.points[0].u, 2); near(turned.points[0].v, -2);
  near(turned.points[1].u, 2); near(turned.points[1].v, 2);
});

test("scaling a copy scales its circle radius and leaves the original", () => {
  const s = sketch();
  s.entities.push({ id: 13, type: "circle", center: 1, radius: 2 });
  const made = transform(s, [{ kind: "entity", id: 13 }], scaling(3, 0, 0), { copy: true, scale: 3 });
  const copy = made.sketch.entities.find((e) => e.id === made.selection.find((x) => x.kind === "entity").id);
  assert.equal(copy.radius, 6);
  assert.equal(made.sketch.entities.find((e) => e.id === 13).radius, 2);
});

test("a mirrored copy flips its arc and is tied to the axis by symmetric constraints", () => {
  const s = sketch();
  s.points.push({ id: 6, u: 0, v: -5 }, { id: 7, u: 10, v: -5 });
  s.entities.push({ id: 14, type: "line", a: 6, b: 7 });
  const made = transform(s, [{ kind: "entity", id: 11 }], reflection(0, -5, 1, 0), { copy: true, mirror: true, axis: 14 });
  const arc = made.sketch.entities.find((e) => e.type === "arc" && e.id !== 11);
  const [start, end] = [arc.start, arc.end].map((id) => made.sketch.points.find((p) => p.id === id));
  near(start.v, -13); near(end.v, -10); // the original end (v 3) and start (v 0) swap roles
  assert.equal(made.sketch.constraints.filter((c) => c.type === "symmetric").length, 3);
});

test("a linear array adds count minus one spaced copies", () => {
  const made = repeat(sketch(), [{ kind: "entity", id: 10 }], 4, (k) => ({ map: translation(0, 5 * k) }));
  const lines = made.sketch.entities.filter((e) => e.type === "line");
  assert.equal(lines.length, 2 + 3);
  const tops = made.sketch.points.filter((p) => p.id > 5).map((p) => p.v).sort((a, b) => a - b);
  assert.deepEqual(tops, [5, 5, 10, 10, 15, 15]);
});

test("splitting a line keeps its direction constraints on both pieces, or ties them together", () => {
  const s = sketch();
  s.constraints = [{ id: 30, type: "horizontal", entity: 10 }, { id: 31, type: "distance", entity: 10, value: 4 }];
  const horizontal = splitLine(s, 10, 1, 0).sketch;
  const first = horizontal.entities.find((e) => e.id === 10);
  assert.ok(horizontal.entities.some((e) => e.type === "line" && e.id !== 10 && e.a === first.b && e.b === 2));
  assert.deepEqual(horizontal.constraints.map((c) => c.type), ["horizontal", "horizontal"]); // the length constraint went
  const loose = sketch();
  const split = splitLine(loose, 10, 1, 0).sketch;
  assert.deepEqual(split.constraints.map((c) => c.type), ["collinear"]);
  const pieces = split.entities.filter((e) => e.type === "line" && (e.id === 10 || e.id > 12));
  assert.equal(pieces.length, 2);
  assert.equal(splitLine(loose, 10, 0.01, 0), null); // too close to an end
});

test("splitting at an existing point on the line joins both pieces to that point and drops its point-on-line constraint", () => {
  const s = sketch();
  s.points.push({ id: 6, u: 1, v: 0 }); // an arc end sitting on the line
  s.entities.push({ id: 13, type: "arc", center: 3, start: 6, end: 4 });
  s.constraints = [{ id: 40, type: "point_on", point: 6, entity: 10 }];
  assert.equal(lineThroughPoint(s, 6), 10);
  const made = splitLine(s, 10, 1, 0, 0, 6);
  assert.equal(made.sketch.points.length, s.points.length); // no new point
  const first = made.sketch.entities.find((e) => e.id === 10);
  const second = made.sketch.entities.find((e) => e.type === "line" && e.id > 13);
  assert.deepEqual([first.a, first.b, second.a, second.b], [1, 6, 6, 2]);
  assert.ok(!made.sketch.constraints.some((c) => c.type === "point_on"));
  assert.equal(lineThroughPoint(made.sketch, 6), null); // it is an end of both pieces now
  assert.equal(lineThroughPoint(s, 5), null); // a point off the line
});
