import test from "node:test";
import assert from "node:assert/strict";
import { leavePromptDisabled } from "../src/leaveprompt.ts";

test("the flag turns the prompt off in development builds", () => {
  assert.equal(leavePromptDisabled(true, "?noleaveprompt=1"), true);
});
test("the flag is ignored in production builds", () => {
  assert.equal(leavePromptDisabled(false, "?noleaveprompt=1"), false);
});
test("without the flag the prompt stays", () => {
  assert.equal(leavePromptDisabled(true, "?dev=1"), false);
  assert.equal(leavePromptDisabled(true, ""), false);
});
