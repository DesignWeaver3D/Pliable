import test from "node:test";
import assert from "node:assert/strict";
import { createHoleEditor } from "../src/holeeditorcard.ts";
import { sectionsFor } from "../src/holeeditor.ts";

/** An editor over stand-ins: `asked` counts the questions to the core, `opened` the forms opened. */
function editor(sels, reply) {
  const state = { asked: 0, opened: 0 };
  const tools = sectionsFor("hole", 1, "wall").map((s) => ({ id: s.tool }));
  const panel = { isOpen: false, openForm: () => state.opened++, setValues: () => {} };
  const card = createHoleEditor({
    toolPanel: () => panel,
    tools: () => tools,
    classify: async () => (state.asked++, reply),
    selection: () => sels,
    busy: () => false,
  });
  return { card, state };
}

const hole = { kind: "hole", pick: "wall" };

test("selecting a hole's wall opens the Hole Editor", async () => {
  const sels = [{ kind: "face", id: 3 }];
  const { card, state } = editor(sels, hole);
  await card.maybeOpen(sels);
  assert.deepEqual(state, { asked: 1, opened: 1 });
});

test("selecting a hole's rim edge leaves the edge selected and opens nothing", async () => {
  const sels = [{ kind: "edge", id: 7 }];
  const { card, state } = editor(sels, { kind: "hole", pick: "other" });
  await card.maybeOpen(sels);
  assert.deepEqual(state, { asked: 0, opened: 0 });
});

test("the Hole Editor button still edits the hole of a selected rim", async () => {
  const sels = [{ kind: "edge", id: 7 }];
  const { card, state } = editor(sels, { kind: "hole", pick: "other" });
  assert.equal(await card.start(sels), null);
  assert.equal(state.opened, 1);
});
