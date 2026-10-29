import test from "node:test";
import assert from "node:assert/strict";
import { parseTyped, typedKey, typedLabels, typedTag, typedTargets } from "../src/sketchtyped.ts";

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("Tab or space moves to the next number only while a number is left to type", () => {
  assert.equal(typedKey("30", "Tab", 2), "30 ");
  assert.equal(typedKey("30 ", "Tab", 2), "30 "); // already on the last number: stays in the entry
  assert.equal(typedKey("30 5", " ", 2), null);
  assert.equal(typedKey("", "Tab", 2), null); // nothing typed: Tab keeps its usual job
  assert.equal(typedKey("30", "Tab", 1), "30");
  assert.equal(typedKey("3", ",", 1), "3.");
  assert.equal(typedKey("30 5", "Backspace", 2), "30 ");
  assert.equal(typedKey("30 5", "Escape", 2), "");
});

test("each drawing tool names the numbers it takes", () => {
  assert.deepEqual(typedLabels("rectangle", 1, false), ["width", "height"]);
  assert.deepEqual(typedLabels("slot", 2, false), ["width"]);
  assert.deepEqual(typedLabels("hexagon", 1, true), ["radius"]);
  assert.deepEqual(typedLabels("circle3", 1, false), []);
  assert.deepEqual(typedLabels("rectangle", 0, false), []);
});

test("typed numbers must be positive", () => {
  assert.deepEqual(parseTyped("30 5"), [30, 5]);
  assert.equal(parseTyped("0"), null);
});

test("a rectangle takes width then height toward the pointer", () => {
  const [p] = typedTargets("rectangle", [{ u: 0, v: 0 }], { u: -3, v: 2 }, [30, 20]);
  assert.deepEqual(p, { u: -30, v: 20 });
  const [c] = typedTargets("rectcentre", [{ u: 0, v: 0 }], { u: 3, v: 2 }, [30, 20]);
  assert.deepEqual(c, { u: 15, v: 10 });
});

test("a slot takes length then width, or only its width when the second end is placed", () => {
  const both = typedTargets("slot", [{ u: 0, v: 0 }], { u: 5, v: 1 }, [40, 10]);
  assert.equal(both.length, 2);
  const run = Math.hypot(5, 1);
  near(both[0].u, (40 * 5) / run); near(both[0].v, (40 * 1) / run);
  near(Math.hypot(both[1].u, both[1].v), 5); // half the width off the first end, square to the axis
  near(both[1].u * both[0].u + both[1].v * both[0].v, 0);
  const width = typedTargets("slot", [{ u: 0, v: 0 }, { u: 40, v: 0 }], { u: 10, v: -3 }, [10]);
  assert.deepEqual(width, [{ u: 0, v: -5 }]);
});

test("an ellipse takes the major width then the minor width", () => {
  const [major, side] = typedTargets("ellipse", [{ u: 0, v: 0 }], { u: 1, v: 0 }, [20, 8]);
  near(major.u, 10); // the typed numbers are full widths, the points sit half of each from the center
  near(Math.abs(side.v), 4);
});

test("an arc takes its radius then the sweep in degrees", () => {
  const [start, end] = typedTargets("arc", [{ u: 0, v: 0 }], { u: 1, v: 0 }, [10, 90]);
  near(start.u, 10);
  near(end.u, 0); near(end.v, 10);
  const [only] = typedTargets("arc", [{ u: 0, v: 0 }, { u: 10, v: 0 }], null, [180]);
  near(only.u, -10);
});

test("the typed tag names each number and marks the one being typed", () => {
  assert.equal(typedTag(["width", "height"], "25"), "Width 25|   Height");
  assert.equal(typedTag(["width", "height"], "25 "), "Width 25   Height |");
  assert.equal(typedTag(["width", "height"], "25 10"), "Width 25   Height 10|");
  assert.equal(typedTag(["radius"], "5"), "Radius 5|");
  assert.equal(typedTag(["long radius", "short radius"], "8 "), "Long radius 8   Short radius |");
  assert.equal(typedTag([], "4"), "4|");
});

test("a circle takes its diameter, a polygon its radius", () => {
  assert.deepEqual(typedLabels("circle", 1, false), ["diameter"]);
  const [rim] = typedTargets("circle", [{ u: 0, v: 0 }], { u: 3, v: 0 }, [10]);
  assert.ok(Math.abs(rim.u - 5) < 1e-9 && Math.abs(rim.v) < 1e-9);
});

test("an elliptical arc takes the major and minor widths and a sweep, and places its points", () => {
  assert.deepEqual(typedLabels("ellarc", 1, false), ["major width", "minor width", "sweep degrees"]);
  assert.deepEqual(typedLabels("ellarc", 2, false), ["minor width", "sweep degrees"]);
  assert.deepEqual(typedLabels("ellarc", 4, false), ["sweep degrees"]);
  const [major, minor, start, end] = typedTargets("ellarc", [{ u: 0, v: 0 }], { u: 1, v: 0 }, [20, 8, 90]);
  near(major.u, 10);
  near(minor.v, 4);
  near(start.u, 10);
  near(end.u, 0);
  assert.ok(end.v > 0);
});
