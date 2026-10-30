import test from "node:test";
import assert from "node:assert/strict";
import { clickAway } from "../src/toolclickaway.ts";

test("only a click on empty space applies an open tool", () => {
  assert.equal(clickAway([]), "apply");
});

test("clicking another item leaves the open tool alone", () => {
  assert.equal(clickAway([{ kind: "face", id: 3 }]), "ignore");
  assert.equal(clickAway([{ kind: "body", id: 1 }, { kind: "body", id: 2 }]), "ignore");
});

test("a Hole Editor card with changes follows the empty-click rule; an unchanged one just closes", async () => {
  const { closesUnchangedCard } = await import("../src/toolclickaway.ts");
  assert.equal(closesUnchangedCard(true, false), true); // opened by a selection, nothing changed: nothing to apply
  assert.equal(closesUnchangedCard(true, true), false); // changed: empty space applies it (clickAway), another item leaves it open
  assert.equal(closesUnchangedCard(false, false), false); // an ordinary tool form is never closed here
  assert.equal(clickAway([]), "apply");
});
