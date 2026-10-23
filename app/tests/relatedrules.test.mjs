import test from "node:test";
import assert from "node:assert/strict";
import { expand, relatedState, ruleFor, setRule } from "../src/relatedrules.ts";

test("a rule is off by default, on for a tool that declares it, and a saved choice wins", () => {
  assert.equal(ruleFor("push_pull", "coplanar"), false);
  assert.equal(ruleFor("resize_hole", "equal_radius"), true);
  setRule("push_pull", "coplanar", true);
  assert.equal(ruleFor("push_pull", "coplanar"), true);
  setRule(null, "parallel", true); // a choice for all tools
  assert.equal(ruleFor("anything", "parallel"), true);
  assert.equal(ruleFor("anything", "coaxial"), false);
});

test("a tool that declares a rule gets the related faces that are switched on, once", () => {
  relatedState.rules = [{ id: "coplanar", label: "Coplanar", faces: [2, 3, 1] }, { id: "symmetric", label: "Symmetric", faces: [9] }];
  const tool = { id: "push_pull", related: ["coplanar", "symmetric"] };
  const face = [{ kind: "face", id: 1 }];
  setRule("push_pull", "coplanar", true);
  setRule("push_pull", "symmetric", false);
  assert.deepEqual(expand(tool, face).map((s) => s.id), [1, 2, 3]);
  assert.deepEqual(expand({ id: "x" }, face), face);
  assert.deepEqual(expand(tool, [{ kind: "edge", id: 1 }]), [{ kind: "edge", id: 1 }]);
  relatedState.rules = [];
});
