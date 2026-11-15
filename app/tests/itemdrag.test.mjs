import test from "node:test";
import assert from "node:assert/strict";

globalThis.window = { addEventListener() {}, setTimeout, clearTimeout };
const { createItemDrag } = await import("../src/itemdrag.ts");
const { app } = await import("../src/appstate.ts");

/** A core whose answers the test hands out one by one, to put a drag in the middle of a slow request. */
function slowCore() {
  const sent = [];
  return {
    sent,
    request(type, params) {
      if (type === "usage_event") return Promise.resolve({});
      return new Promise((resolve, reject) => sent.push({ type, params, resolve, reject }));
    },
    answer(index, mesh = { header: { timings: {} }, vertices: [], indices: [] }) {
      this.sent[index].resolve(mesh);
    },
    ofType: (core, type) => core.sent.filter((r) => r.type === type),
  };
}

const classes = { toggle() {}, remove() {}, add() {}, contains: () => false };
const el = () => ({ classList: classes, style: {}, hidden: false, textContent: "" });

function setup() {
  const core = slowCore();
  const tool = { id: "move_body", params: [{ name: "dx", drag: true }] };
  const log = { committed: [], shown: 0 };
  const sels = [{ kind: "body", id: 5 }];
  const drag = createItemDrag({
    viewport: { measureMode: false, measureSel: null, primaryMeasure: null, dragging: false, pushPull: { symmetric: false, params: () => ({}), reset() {} }, pullDirection: { params: () => ({}) }, pullGizmo: {}, manipulator: {}, selectItems() {} },
    core,
    status: el(),
    latency: el(),
    dimLabel: el(),
    measurePanel: { hide() {} },
    dimensionOverlay: { set() {} },
    armedTool: null,
    dragToolFor: () => tool,
    show: () => log.shown++,
    setCommitted: (mesh) => log.committed.push(mesh),
    setSelection() {},
    selectionPayload: (s) => ({ bodies: s.map((x) => x.id) }),
    mappedSelection: () => sels,
    rememberOp() {},
    pushPullCard: { isOpen: false, open() {}, showDistance() {}, clearDistance() {} },
  });
  return { core, drag, sels, log };
}

const settle = () => new Promise((r) => setTimeout(r, 5));

test("a drag released while its first preview is slow commits the released distance", async () => {
  const { core, drag, sels, log } = setup();
  app.committed = { header: {} };
  void drag.onItemDrag(sels, 5, "move", 0, 0);
  void drag.onItemDrag(sels, 10, "move", 0, 0);
  const end = drag.onItemDrag(sels, 10, "end", 0, 0);
  await settle();
  core.answer(0); // the slow first preview (5) comes back after release
  await settle();
  const commits = core.ofType(core, "tool_commit");
  assert.equal(commits.length, 1);
  assert.equal(commits[0].params.params.dx, 10);
  core.answer(core.sent.indexOf(commits[0]));
  await end;
  assert.equal(log.committed.length, 1);
});

test("a second drag started while the first commit is slow is neither lost nor mixed into it", async () => {
  const { core, drag, sels, log } = setup();
  app.committed = { header: {} };
  void drag.onItemDrag(sels, 5, "move", 0, 0);
  const end1 = drag.onItemDrag(sels, 5, "end", 0, 0);
  await settle();
  core.answer(0);
  await settle();
  // the first commit (dx 5) is now waiting for the core; the user grabs the arrow again
  void drag.onItemDrag(sels, 8, "move", 0, 0);
  await settle();
  const end2 = drag.onItemDrag(sels, 8, "end", 0, 0);
  await settle();
  // answer everything in the order the core would
  for (let i = 1; i < 10 && core.sent.length > i; i++) {
    core.answer(i);
    await settle();
  }
  await Promise.all([end1, end2]);
  const commits = core.ofType(core, "tool_commit").map((r) => r.params.params.dx);
  assert.deepEqual(commits, [5, 8]);
  assert.equal(log.committed.length, 2);
});

test("a second drag started while the first is still waiting for its preview is committed too", async () => {
  const { core, drag, sels, log } = setup();
  app.committed = { header: {} };
  void drag.onItemDrag(sels, 5, "move", 0, 0); // preview 0 in flight, slow
  const end1 = drag.onItemDrag(sels, 5, "end", 0, 0); // released: waits for it
  await settle();
  void drag.onItemDrag(sels, 8, "move", 0, 0); // grabbed again meanwhile
  await settle();
  const end2 = drag.onItemDrag(sels, 8, "end", 0, 0);
  await settle();
  for (let i = 0; i < 12; i++) {
    if (core.sent[i] && !core.sent[i].done) {
      core.sent[i].done = true;
      core.answer(i);
      await settle();
    }
  }
  await Promise.all([end1, end2]);
  const commits = core.ofType(core, "tool_commit").map((r) => r.params.params.dx);
  console.log("commits sent", commits, "previews", core.ofType(core, "tool_preview").map((r) => r.params.params.dx), "setCommitted", log.committed.length);
  assert.deepEqual(commits, [5, 8]);
});
