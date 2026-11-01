import test from "node:test";
import assert from "node:assert/strict";
import { leaderAngle } from "../src/sketchleaderangle.ts";

const DEG = Math.PI / 180;
const deg = (a) => Math.round((a / DEG) * 100) / 100;
const sketchOf = (constraints) => ({
  plane: { origin: [0, 0, 0], normal: [0, 0, 1], xdir: [1, 0, 0] },
  points: [{ id: 1, u: 0, v: 0 }, { id: 2, u: 50, v: 0 }],
  entities: [
    { id: 10, type: "circle", center: 1, radius: 5 },
    { id: 11, type: "circle", center: 1, radius: 8 },
    { id: 12, type: "circle", center: 2, radius: 3 },
  ],
  constraints,
});
const up = { u: 4, v: 4 };

test("A circle with no other dimension on its center gets 45° in the pointer's quadrant", () => {
  assert.equal(deg(leaderAngle(sketchOf([]), 10, "diameter", up)), 45);
  assert.equal(deg(leaderAngle(sketchOf([]), 10, "diameter", { u: -4, v: -4 })), -135);
  assert.equal(deg(leaderAngle(sketchOf([]), 10, "radius", { u: 4, v: -1 })), -45);
  assert.equal(leaderAngle(sketchOf([]), undefined, "radius", up), undefined);
  assert.equal(deg(leaderAngle(sketchOf([]), 10, "radius", null)), 45); // no pointer: up and to the right
});

test("Concentric dimensions fill the quadrant from 45° outward, the 15° steps before the 7.5° gaps", () => {
  const constraints = [];
  const order = [];
  for (let i = 0; i < 9; i++) {
    const angle = leaderAngle(sketchOf(constraints), i % 2 ? 10 : 11, "radius", { u: 4, v: 4 });
    order.push(deg(angle));
    constraints.push({ id: 100 + i, type: "radius", entity: i % 2 ? 10 : 11, value: 5, angle });
  }
  assert.deepEqual(order, [45, 60, 30, 75, 15, 52.5, 37.5, 67.5, 22.5].map((a) => a));
});

test("The pair of slots at the same distance is ordered by the side the pointer was on", () => {
  const s = sketchOf([{ id: 100, type: "radius", entity: 10, value: 5, angle: 45 * DEG }]);
  assert.equal(deg(leaderAngle(s, 11, "radius", { u: 2, v: 6 })), 60); // nearer the vertical
  assert.equal(deg(leaderAngle(s, 11, "radius", { u: 6, v: 2 })), 30); // nearer the horizontal
});

test("A diameter takes both ends: a new dimension avoids the far end in the opposite quadrant", () => {
  const s = sketchOf([{ id: 100, type: "diameter", entity: 10, value: 10, angle: 45 * DEG }]);
  assert.equal(deg(leaderAngle(s, 11, "radius", { u: -4, v: -4 })), -120); // 225° is taken, so 240° (60° into that quadrant)
  assert.equal(deg(leaderAngle(s, 11, "diameter", up)), 60);
});

test("Dragged dimensions count where they were dragged, and other centers are ignored", () => {
  const dragged = sketchOf([{ id: 100, type: "radius", entity: 10, value: 5, place: [10, 10] }]);
  assert.equal(deg(leaderAngle(dragged, 11, "radius", up)), 60);
  const elsewhere = sketchOf([{ id: 100, type: "radius", entity: 12, value: 3, angle: 45 * DEG }]);
  assert.equal(deg(leaderAngle(elsewhere, 11, "radius", up)), 45);
});

test("When the pointer's quadrant is full the next quadrant is used, and when all are full it stacks", () => {
  const constraints = [];
  for (let i = 0; i < 9; i++) constraints.push({ id: 100 + i, type: "radius", entity: 10, value: 5, angle: [45, 60, 30, 75, 15, 52.5, 37.5, 67.5, 22.5][i] * DEG });
  assert.equal(deg(leaderAngle(sketchOf(constraints), 11, "radius", up)), 135); // the quadrant beside it, 45° into it
  for (const [qx, qy] of [[-1, 1], [1, -1], [-1, -1]]) {
    for (const local of [45, 60, 30, 75, 15, 52.5, 37.5, 67.5, 22.5]) constraints.push({ id: 200 + constraints.length, type: "radius", entity: 10, value: 5, angle: Math.atan2(qy * Math.sin(local * DEG), qx * Math.cos(local * DEG)) });
  }
  assert.equal(deg(leaderAngle(sketchOf(constraints), 11, "radius", up)), 45);
});

// An arc from 0° to 120° about point 1 (middle 60°, room for slots from 7.5° to 112.5°), and a second one on the same center.
const arcSketch = (constraints, sweepTo = 120) => ({
  plane: { origin: [0, 0, 0], normal: [0, 0, 1], xdir: [1, 0, 0] },
  points: [{ id: 1, u: 0, v: 0 }, { id: 2, u: 10, v: 0 }, { id: 3, u: 10 * Math.cos(sweepTo * DEG), v: 10 * Math.sin(sweepTo * DEG) }],
  entities: [{ id: 20, type: "arc", center: 1, start: 2, end: 3 }, { id: 21, type: "arc", center: 1, start: 2, end: 3 }, { id: 10, type: "circle", center: 1, radius: 5 }],
  constraints,
});

test("The first dimension on an arc is at the middle of its curve", () => {
  assert.equal(deg(leaderAngle(arcSketch([]), 20, "radius")), 60);
  assert.equal(deg(leaderAngle(arcSketch([]), 20, "radius", { u: -5, v: 5 })), 60);
});

test("Concentric arcs fill the curve from the middle outward, then go on past the ends alternating sides", () => {
  const constraints = [];
  const order = [];
  for (let i = 0; i < 12; i++) {
    const angle = leaderAngle(arcSketch(constraints), i % 2 ? 20 : 21, "radius", { u: 3, v: 6 }); // pointer on the end's side of the middle
    order.push(deg(angle));
    constraints.push({ id: 100 + i, type: "radius", entity: i % 2 ? 20 : 21, value: 10, angle });
  }
  // 60, then 75/45 (15° steps, the end's side first), 90/30, 105/15 (7.5° from each end is the limit), then the 7.5° gaps 67.5/52.5, 82.5/37.5 ...
  assert.deepEqual(order.slice(0, 7), [60, 75, 45, 90, 30, 105, 15]);
  assert.deepEqual(order.slice(7), [67.5, 52.5, 82.5, 37.5, 97.5]);
});

test("A short arc has only its middle, then the slots past its ends alternate sides at 7.5° spacing", () => {
  const constraints = [{ id: 100, type: "radius", entity: 21, value: 10, angle: 5 * DEG }];
  const s = () => arcSketch(constraints, 10); // 0° to 10°: middle 5°, no room inside for others
  const next = [];
  for (let i = 0; i < 3; i++) {
    const angle = leaderAngle(s(), 20, "radius");
    next.push(deg(angle));
    constraints.push({ id: 101 + i, type: "radius", entity: 20, value: 10, angle });
  }
  assert.deepEqual(next, [17.5, -7.5, 25]); // past the end first (10 + 7.5), then before the start (0 - 7.5), then 10 + 15
});

test("Circles and arcs on one center avoid each other, a diameter on an arc takes the far end too, and no center means no preference", () => {
  const withArc = arcSketch([{ id: 100, type: "radius", entity: 20, value: 10, angle: 45 * DEG }]);
  assert.equal(deg(leaderAngle(withArc, 10, "radius", { u: 4, v: 4 })), 60); // the circle's 45° is taken by the arc's leader
  const withCircle = arcSketch([{ id: 100, type: "radius", entity: 10, value: 5, angle: 60 * DEG }]);
  assert.equal(deg(leaderAngle(withCircle, 20, "radius", { u: 3, v: 6 })), 75); // the arc's middle (60°) is taken by the circle's leader
  const far = arcSketch([{ id: 100, type: "radius", entity: 10, value: 5, angle: 240 * DEG }]);
  assert.equal(deg(leaderAngle(far, 20, "diameter")), 75); // a diameter at 60° would also use 240°
  assert.equal(deg(leaderAngle(arcSketch([]), 10, "radius")), 45);
});
