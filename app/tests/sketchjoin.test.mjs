import test from "node:test";
import assert from "node:assert/strict";
import { joinCurves } from "../src/sketchjoincurves.ts";

const plane = { origin: [0, 0, 0], normal: [0, 0, 1], xdir: [1, 0, 0] };
const sk = (points, entities, constraints = []) => ({ plane, points, entities, constraints });
const line = (id, a, b) => ({ id, type: "line", a, b });

test("two collinear lines that share an end become one line, keeping what still applies", () => {
  const s = sk(
    [{ id: 1, u: 0, v: 0 }, { id: 2, u: 4, v: 0 }, { id: 3, u: 10, v: 0 }],
    [line(10, 1, 2), line(11, 2, 3)],
    [
      { id: 20, type: "horizontal", entity: 10 },
      { id: 21, type: "horizontal", entity: 11 },
      { id: 22, type: "collinear", entities: [10, 11], auto: true },
      { id: 23, type: "distance", points: [1, 2], value: 4 },
      { id: 24, type: "distance", entity: 11, value: 6 },
      { id: 25, type: "point_on", point: 2, entity: 10 },
    ],
  );
  const r = joinCurves(s, [10, 11]);
  assert.equal(typeof r, "object");
  assert.deepEqual(r.entities, [{ id: 10, type: "line", a: 1, b: 3 }]);
  assert.deepEqual(r.points.map((p) => p.id), [1, 3]);
  assert.deepEqual(r.constraints.map((c) => c.id), [20]);
});

test("a joint that another curve ends at stays, held on the joined line", () => {
  const s = sk(
    [{ id: 1, u: 0, v: 0 }, { id: 2, u: 4, v: 0 }, { id: 3, u: 10, v: 0 }, { id: 4, u: 4, v: 5 }],
    [line(10, 1, 2), line(11, 3, 2), line(12, 2, 4)],
  );
  const r = joinCurves(s, [11, 10]);
  assert.equal(r.entities.length, 2);
  assert.deepEqual(r.entities[0], { id: 11, type: "line", a: 3, b: 1 });
  assert.ok(r.points.some((p) => p.id === 2));
  assert.ok(r.constraints.some((c) => c.type === "point_on" && c.point === 2 && c.entity === 11));
});

test("lines that are not straight, do not connect, or fold back are refused", () => {
  const bent = sk([{ id: 1, u: 0, v: 0 }, { id: 2, u: 4, v: 0 }, { id: 3, u: 8, v: 3 }], [line(10, 1, 2), line(11, 2, 3)]);
  assert.match(joinCurves(bent, [10, 11]), /one straight line/);
  const apart = sk([{ id: 1, u: 0, v: 0 }, { id: 2, u: 4, v: 0 }, { id: 3, u: 5, v: 0 }, { id: 4, u: 9, v: 0 }], [line(10, 1, 2), line(11, 3, 4)]);
  assert.match(joinCurves(apart, [10, 11]), /do not connect/);
  const fold = sk([{ id: 1, u: 0, v: 0 }, { id: 2, u: 4, v: 0 }, { id: 3, u: 2, v: 0 }], [line(10, 1, 2), line(11, 2, 3)]);
  assert.match(joinCurves(fold, [10, 11]), /fold back/);
  assert.match(joinCurves(apart, [10]), /two or more/);
});

test("a held Coincident constraint connects lines whose ends are separate points", () => {
  const s = sk([{ id: 1, u: 0, v: 0 }, { id: 2, u: 4, v: 0 }, { id: 3, u: 4, v: 0 }, { id: 4, u: 9, v: 0 }], [line(10, 1, 2), line(11, 3, 4)], [{ id: 30, type: "coincident", points: [2, 3] }]);
  const r = joinCurves(s, [10, 11]);
  assert.deepEqual(r.entities, [{ id: 10, type: "line", a: 1, b: 4 }]);
  assert.deepEqual(r.points.map((p) => p.id), [1, 4]);
  assert.equal(r.constraints.length, 0);
});

const arcs = () =>
  sk(
    [{ id: 1, u: 0, v: 0 }, { id: 2, u: 5, v: 0 }, { id: 3, u: 0, v: 5 }, { id: 4, u: -5, v: 0 }],
    [{ id: 10, type: "arc", center: 1, start: 2, end: 3 }, { id: 11, type: "arc", center: 1, start: 3, end: 4 }],
    [{ id: 20, type: "radius", entity: 10, value: 5 }, { id: 21, type: "radius", entity: 11, value: 5 }, { id: 22, type: "tangent", entities: [10, 11] }],
  );

test("arcs on one circle become one arc, and arcs that close up become a circle", () => {
  const r = joinCurves(arcs(), [11, 10]);
  assert.deepEqual(r.entities, [{ id: 11, type: "arc", center: 1, start: 2, end: 4 }]);
  assert.deepEqual(r.constraints.map((c) => [c.type, c.entity]), [["radius", 11]]);
  const full = arcs();
  full.points.push({ id: 5, u: 0, v: -5 });
  full.entities.push({ id: 12, type: "arc", center: 1, start: 4, end: 5 }, { id: 13, type: "arc", center: 1, start: 5, end: 2 });
  const c = joinCurves(full, [10, 11, 12, 13]);
  assert.deepEqual(c.entities, [{ id: 10, type: "circle", center: 1, radius: 5 }]);
  assert.deepEqual(c.points.map((p) => p.id), [1]);
});

test("arcs on different circles, in a mix, or overlapping are refused", () => {
  const other = arcs();
  other.points.push({ id: 6, u: 0, v: 1 });
  other.entities[1] = { id: 11, type: "arc", center: 6, start: 3, end: 4 };
  assert.match(joinCurves(other, [10, 11]), /not on one circle/);
  const mixed = arcs();
  mixed.entities.push(line(12, 4, 2));
  assert.match(joinCurves(mixed, [10, 12]), /one kind/);
  const over = arcs();
  over.points.push({ id: 5, u: 0, v: -5 });
  over.entities = [{ id: 10, type: "arc", center: 1, start: 2, end: 4 }, { id: 11, type: "arc", center: 1, start: 4, end: 5 }, { id: 12, type: "arc", center: 1, start: 5, end: 3 }];
  assert.match(joinCurves(over, [10, 11, 12]), /overlap/);
});

test("splines that meet at an end become one spline through all their points", () => {
  const s = sk(
    [{ id: 1, u: 0, v: 0 }, { id: 2, u: 2, v: 2 }, { id: 3, u: 4, v: 0 }, { id: 4, u: 6, v: 2 }, { id: 5, u: 8, v: 0 }],
    [{ id: 10, type: "spline", points: [1, 2, 3] }, { id: 11, type: "spline", points: [5, 4, 3] }],
  );
  const r = joinCurves(s, [10, 11]);
  assert.deepEqual(r.entities, [{ id: 10, type: "spline", points: [1, 2, 3, 4, 5] }]);
  assert.equal(r.points.length, 5);
  assert.match(joinCurves({ ...s, entities: [{ id: 10, type: "spline", points: [1, 2, 3] }, { id: 11, type: "circle", center: 4, radius: 1 }] }, [10, 11]), /lines, arcs and splines/);
});
