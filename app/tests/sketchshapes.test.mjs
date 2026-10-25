import test from "node:test";
import assert from "node:assert/strict";
import { arcThrough, circumcircle, distanceToAxis, slotCorners } from "../src/sketchshapes.ts";

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("the circle through three points", () => {
  const c = circumcircle({ u: 5, v: 0 }, { u: 0, v: 5 }, { u: -5, v: 0 });
  near(c.u, 0); near(c.v, 0); near(c.radius, 5);
  assert.equal(circumcircle({ u: 0, v: 0 }, { u: 1, v: 1 }, { u: 2, v: 2 }), null);
});

test("a three-point arc runs counterclockwise from whichever end comes first that way", () => {
  // over the top, left to right is clockwise, so the arc runs from the right end to the left end
  const over = arcThrough({ u: -5, v: 0 }, { u: 0, v: 5 }, { u: 5, v: 0 });
  assert.equal(over.from, "end");
  const under = arcThrough({ u: -5, v: 0 }, { u: 0, v: -5 }, { u: 5, v: 0 });
  assert.equal(under.from, "start");
  near(under.radius, 5);
});

test("slot corners lie either side of the axis between the end centres", () => {
  const s = slotCorners({ u: 0, v: 0 }, { u: 10, v: 0 }, 2);
  assert.deepEqual([s.aLeft.v, s.aRight.v, s.bLeft.u], [2, -2, 10]);
  assert.equal(slotCorners({ u: 1, v: 1 }, { u: 1, v: 1 }, 2), null);
  near(distanceToAxis({ u: 0, v: 0 }, { u: 10, v: 0 }, { u: 3, v: -4 }), 4);
});
