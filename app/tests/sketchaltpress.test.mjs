import test from "node:test";
import assert from "node:assert/strict";
import { BareAltPress } from "../src/sketchaltpress.ts";

test("Alt pressed and released on its own is a bare press", () => {
  const alt = new BareAltPress();
  alt.down("Alt");
  assert.equal(alt.up("Alt"), true);
  assert.equal(alt.up("Alt"), false); // a release with no press before it is nothing
});

test("Alt used with another key or a pointer press is a modifier, not a bare press", () => {
  const alt = new BareAltPress();
  alt.down("Alt");
  alt.down("c");
  assert.equal(alt.up("Alt"), false);
  alt.down("Alt");
  alt.spoil();
  assert.equal(alt.up("Alt"), false);
});

test("Holding Alt (key repeat) is still one press, and other keys' releases are ignored", () => {
  const alt = new BareAltPress();
  alt.down("Alt");
  alt.down("Alt", true);
  alt.down("Alt", true);
  assert.equal(alt.up("x"), false);
  assert.equal(alt.up("Alt"), true);
  alt.down("Alt");
  alt.down("x");
  alt.down("Alt", true); // a repeat after another key does not restart the press
  assert.equal(alt.up("Alt"), false);
});
