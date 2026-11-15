import test from "node:test";
import assert from "node:assert/strict";
import { pushUndo, undoStep } from "../src/sketchundo.ts";
import { guard, needsConfirm } from "../src/sketchleave.ts";
import { onKey } from "../src/sketchkeydown.ts";
import { changeConstraints, chooseConstraint, constraintChoices } from "../src/sketchconstrain.ts";
import { applyTyped, typedLabels } from "../src/sketchtypedapply.ts";
import { applyEdit } from "../src/sketchtransform.ts";

// A stand-in for the sketch mode. `active` reads true only once per `arm()`: the key handler checks it at its start,
// and the redraw that follows then finds the mode inactive and draws nothing (the real redraw needs a 3D view).
function context(extra = {}) {
  let armed = 0;
  const mode = {
    s: {
      plane: { origin: [0, 0, 0], normal: [0, 0, 1], xdir: [1, 0, 0] },
      points: [{ id: 1, u: 0, v: 0 }, { id: 2, u: 4, v: 0 }, { id: 3, u: 4, v: 3 }],
      entities: [{ id: 10, type: "line", a: 1, b: 2 }, { id: 11, type: "line", a: 2, b: 3 }],
      constraints: [],
    },
    undoStack: [],
    redoStack: [],
    selection: [],
    boxSelection: null,
    selectedDimensions: new Set(),
    chain: [],
    tool: "select",
    lastDrawTool: null,
    typed: "",
    projectPick: null,
    settingsDialog: null,
    leaveDialog: null,
    trimCandidates: new Set(),
    kept: false,
    failed: new Set(),
    tools: [],
    statuses: [],
    solves: 0,
    solveResults: [],
    host: { status(text, level) { mode.statuses.push({ text, level }); } },
    solver: { async resolve() { mode.solves++; return mode.solveResults.length ? mode.solveResults.shift() : true; } },
    viewport: { manipulator: { clear() {}, setHandles() {} } },
    plane: { setFromNormalAndCoplanarPoint() {} },
    options: { grid: false },
    grid: null,
    group: { add() {}, remove() {} },
    gizmosShown: false,
    setTool(t) { mode.tools.push(t); mode.tool = t; },
    arm() { armed = 1; },
    ...extra,
  };
  Object.defineProperty(mode, "active", { get: () => (armed-- > 0), configurable: true });
  return mode;
}
const key = (k, extra = {}) => ({ key: k, target: { closest: () => null }, ctrlKey: false, metaKey: false, shiftKey: false, prevented: 0, preventDefault() { this.prevented++; }, stopImmediatePropagation() {}, ...extra });

test("pushUndo keeps a snapshot, clears redo and holds at most 100 steps", () => {
  const mode = context();
  mode.redoStack = ["x"];
  pushUndo(mode);
  assert.equal(mode.undoStack.length, 1);
  assert.deepEqual(mode.redoStack, []);
  for (let i = 0; i < 120; i++) pushUndo(mode);
  assert.equal(mode.undoStack.length, 100);
});

test("undo restores the earlier sketch and redo brings the change back", () => {
  const mode = context();
  pushUndo(mode);
  mode.s.points.push({ id: 4, u: 9, v: 9 });
  mode.selection = [{ kind: "point", id: 1 }];
  mode.chain = [1];
  undoStep(mode, "undo");
  assert.equal(mode.s.points.length, 3);
  assert.deepEqual(mode.selection, []);
  assert.deepEqual(mode.chain, []);
  assert.equal(mode.redoStack.length, 1);
  assert.equal(mode.solves, 1);
  undoStep(mode, "redo");
  assert.equal(mode.s.points.length, 4);
  undoStep(mode, "redo"); // nothing more to redo
  assert.equal(mode.s.points.length, 4);
});

test("needsConfirm asks for new geometry or changes to a kept sketch, not for reference geometry", () => {
  const mode = context();
  assert.equal(needsConfirm(mode), true);
  mode.s.entities = [{ id: 10, type: "line", a: 1, b: 2, reference: true }];
  assert.equal(needsConfirm(mode), false);
  mode.kept = true;
  assert.equal(needsConfirm(mode), false);
  mode.undoStack.push("x");
  assert.equal(needsConfirm(mode), true);
});

test("guard shows a failing action in the status line instead of throwing", async () => {
  const mode = context();
  const log = console.error;
  console.error = () => {};
  try {
    await guard(mode, () => { throw new Error("boom"); });
    await guard(mode, async () => { throw new Error("later"); });
  } finally {
    console.error = log;
  }
  assert.equal(mode.statuses.length, 2);
  assert.match(mode.statuses[0].text, /That did not work: boom/);
  assert.equal(mode.statuses[1].level, true);
});

test("Escape and Enter step back one level: chain, tool, selection", () => {
  const mode = context({ chain: [1], tool: "line" });
  mode.arm();
  onKey(mode, key("Escape"));
  assert.deepEqual(mode.chain, []);
  mode.arm();
  onKey(mode, key("Escape"));
  assert.deepEqual(mode.tools, ["select"]);
  mode.selection = [{ kind: "point", id: 1 }];
  mode.arm();
  onKey(mode, key("Escape"));
  assert.deepEqual(mode.selection, []);
  mode.lastDrawTool = "circle";
  mode.arm();
  onKey(mode, key("Enter"));
  assert.deepEqual(mode.tools, ["select", "circle"]);
});

test("keys are ignored while typing in a field or when a dialog is open", () => {
  const mode = context({ chain: [1], tool: "line" });
  mode.arm();
  onKey(mode, key("Escape", { target: { closest: () => ({}) } }));
  assert.deepEqual(mode.chain, [1]);
  mode.settingsDialog = { open: true };
  mode.arm();
  onKey(mode, key("Escape"));
  assert.deepEqual(mode.chain, [1]);
  onKey(context({ chain: [1] }), key("Escape")); // inactive mode: nothing
});

test("Ctrl+Z undoes, Ctrl+Shift+Z and Ctrl+Y redo, and the key does not reach other handlers", () => {
  const mode = context();
  pushUndo(mode);
  mode.s.points.push({ id: 4, u: 1, v: 1 });
  mode.arm();
  const e = key("z", { ctrlKey: true });
  onKey(mode, e);
  assert.equal(e.prevented, 1);
  assert.equal(mode.s.points.length, 3);
  mode.arm();
  onKey(mode, key("y", { ctrlKey: true }));
  assert.equal(mode.s.points.length, 4);
});

test("Delete removes the selected geometry in one undo step and keeps the sketch's own axes", () => {
  const mode = context({ selection: [{ kind: "entity", id: 11 }] });
  mode.arm();
  onKey(mode, key("Delete"));
  assert.deepEqual(mode.s.entities.map((x) => x.id), [10]);
  assert.deepEqual(mode.selection, []);
  assert.equal(mode.undoStack.length, 1);
  assert.equal(mode.solves, 1);
});

test("Delete on picked constraint marks removes only those constraints and says so", () => {
  const mode = context();
  mode.s.constraints = [{ id: 20, type: "horizontal", entity: 10 }, { id: 21, type: "vertical", entity: 11 }];
  mode.selectedDimensions = new Set([20]);
  mode.arm();
  onKey(mode, key("Delete"));
  assert.deepEqual(mode.s.constraints.map((c) => c.id), [21]);
  assert.equal(mode.selectedDimensions.size, 0);
  assert.match(mode.statuses[0].text, /Deleted 1 constraint \(Undo brings it back\)/);
  assert.equal(mode.s.entities.length, 2); // the geometry stays
});

test("Delete with only some points of a box selected deletes nothing and explains", () => {
  const mode = context();
  mode.selection = mode.boxSelection = [{ kind: "point", id: 1 }];
  mode.arm();
  onKey(mode, key("Delete"));
  assert.equal(mode.s.entities.length, 2);
  assert.equal(mode.undoStack.length, 0);
  assert.match(mode.statuses[0].text, /nothing was deleted/);
});

test("constraint buttons list every choice, and a button that does not fit says what it needs", () => {
  const mode = context({ selection: [{ kind: "entity", id: 10 }] });
  const choices = constraintChoices(mode);
  assert.ok(choices.length > 5);
  assert.ok(choices.some((c) => c.enabled) && choices.some((c) => !c.enabled));
  const disabled = choices.find((c) => !c.enabled).label;
  chooseConstraint(mode, disabled);
  assert.match(mode.statuses.at(-1).text, new RegExp(`^${disabled.replace(/[()]/g, "\\$&")} does not fit the current selection. Needs: `));
  assert.equal(mode.statuses.at(-1).level, "warn");
  assert.equal(mode.undoStack.length, 0);
});

test("changeConstraints keeps a change that solves and takes back one that does not", async () => {
  const mode = context();
  mode.s.constraints = [{ id: 20, type: "horizontal", entity: 10 }];
  await changeConstraints(mode, (cs) => cs.filter((c) => c.id !== 20), "failed");
  assert.deepEqual(mode.s.constraints, []);
  assert.equal(mode.undoStack.length, 1);
  const bad = context();
  bad.s.constraints = [{ id: 20, type: "horizontal", entity: 10 }];
  bad.solveResults = [false, true];
  await changeConstraints(bad, () => [], "That change fails");
  assert.equal(bad.s.constraints.length, 1);
  assert.equal(bad.undoStack.length, 0);
  assert.deepEqual(bad.statuses[0], { text: "That change fails", level: true });
  assert.equal(bad.solves, 2);
});

test("applyEdit keeps an edit that solves and undoes one the constraints refuse", async () => {
  const mode = context();
  await applyEdit(mode, () => ({ sketch: { ...mode.s, points: [] }, selection: [{ kind: "point", id: 1 }] }));
  assert.deepEqual(mode.s.points, []);
  assert.deepEqual(mode.selection, [{ kind: "point", id: 1 }]);
  assert.equal(mode.undoStack.length, 1);
  const refused = context();
  refused.solveResults = [false, true];
  await applyEdit(refused, () => ({ sketch: { ...refused.s, points: [] }, selection: [{ kind: "point", id: 1 }] }));
  assert.equal(refused.s.points.length, 3);
  assert.deepEqual(refused.selection, []);
  assert.equal(refused.undoStack.length, 0);
  assert.match(refused.statuses[0].text, /do not allow that change/);
});

test("typed labels exist only for an active drawing tool", () => {
  assert.deepEqual(typedLabels(context({ tool: "line", chain: [{ u: 0, v: 0 }], sidesOf: () => 0 })), []); // inactive: nothing
  const mode = context({ tool: "line", chain: [{ u: 0, v: 0 }], sidesOf: () => 0 });
  mode.arm();
  assert.ok(Array.isArray(typedLabels(mode)));
});

test("a typed line length is placed toward the pointer and kept as a dimension", async () => {
  const placed = [];
  const mode = context({
    tool: "line",
    chain: [{ u: 0, v: 0 }],
    cursor: { u: 0, v: 5 },
    typed: "3",
    sidesOf: () => 0,
    addLine(a, b) {
      placed.push([a, b]);
      mode.s.entities.push({ id: 30, type: "line", a: 1, b: 2 });
      return false;
    },
  });
  Object.defineProperty(mode, "active", { get: () => true, configurable: true });
  Object.defineProperty(mode, "renders", { value: 0, writable: true });
  mode.overlay = { draw() {} };
  // The redraw at the end needs the 3D view: stop it by making the mode inactive once the shape is placed.
  const original = mode.addLine;
  mode.addLine = (a, b) => {
    const r = original(a, b);
    Object.defineProperty(mode, "active", { get: () => false, configurable: true });
    return r;
  };
  await applyTyped(mode);
  assert.equal(placed.length, 1);
  assert.ok(Math.abs(placed[0][1].u) < 1e-9 && Math.abs(placed[0][1].v - 3) < 1e-9);
  assert.equal(mode.typed, "");
  assert.deepEqual(mode.s.constraints.map((c) => [c.type, c.entity, c.value]), [["distance", 30, 3]]);
  assert.equal(mode.placingTyped, false);
});

test("typed text that is not a positive size says so and places nothing", async () => {
  const mode = context({ tool: "line", chain: [{ u: 0, v: 0 }], typed: "abc", sidesOf: () => 0 });
  await applyTyped(mode);
  assert.deepEqual(mode.statuses[0], { text: "That is not a positive size", level: true });
  assert.equal(mode.typed, "");
});
