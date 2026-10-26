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
