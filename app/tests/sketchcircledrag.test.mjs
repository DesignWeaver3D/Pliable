import test from "node:test";
import assert from "node:assert/strict";
import { isFreeCircle, draggedRadius } from "../src/sketchcircledrag.ts";

const sk = (constraints = []) => ({
  points: [{ id: 1, u: 0, v: 0 }],
  entities: [{ id: 2, type: "circle", center: 1, radius: 5 }],
  constraints,
});

test("a circle no constraint mentions is free to resize by its rim", () => {
  assert.equal(isFreeCircle(sk(), 2), true);
  assert.equal(isFreeCircle(sk([{ id: 3, type: "fixed", point: 1 }]), 2), true);
});

test("a circle with a dimension or relation on it moves instead", () => {
  assert.equal(isFreeCircle(sk([{ id: 3, type: "diameter", entity: 2, value: 10 }]), 2), false);
  assert.equal(isFreeCircle(sk([{ id: 3, type: "tangent", entities: [2, 9] }]), 2), false);
});

test("the dragged radius is the distance from the centre and never zero", () => {
  assert.equal(draggedRadius({ u: 1, v: 1 }, 4, 5), 5);
  assert.ok(draggedRadius({ u: 1, v: 1 }, 1, 1) > 0);
});
