import test from "node:test";
import assert from "node:assert/strict";
import { UNSAVED_MARK, hasUnsavedWork, pageTitle } from "../src/unsaved.ts";

const state = (over = {}) => ({ canUndo: false, sketchOpen: false, state: "1:0", saved: null, ...over });

test("a model with no edits has nothing unsaved", () => {
  assert.equal(hasUnsavedWork(state()), false);
});

test("an edited model is unsaved until that state is saved as a project", () => {
  assert.equal(hasUnsavedWork(state({ canUndo: true, state: "1:3" })), true);
  assert.equal(hasUnsavedWork(state({ canUndo: true, state: "1:3", saved: "1:3" })), false);
});

test("an edit after the save, or an undo back past it, is unsaved again", () => {
  assert.equal(hasUnsavedWork(state({ canUndo: true, state: "1:4", saved: "1:3" })), true);
  assert.equal(hasUnsavedWork(state({ canUndo: true, state: "1:2", saved: "1:3" })), true);
});

test("the same state number in another document does not count as saved", () => {
  assert.equal(hasUnsavedWork(state({ canUndo: true, state: "2:3", saved: "1:3" })), true);
});

test("an open sketch is always unsaved work", () => {
  assert.equal(hasUnsavedWork(state({ sketchOpen: true, state: "1:3", saved: "1:3" })), true);
});

test("a core that names no state falls back to the undo rule", () => {
  assert.equal(hasUnsavedWork(state({ canUndo: true, state: null })), true);
  assert.equal(hasUnsavedWork(state({ canUndo: false, state: null })), false);
});

test("the title carries the mark only while there is unsaved work", () => {
  assert.equal(pageTitle("Pliable", false), "Pliable");
  assert.equal(pageTitle("Pliable", true), UNSAVED_MARK + "Pliable");
});
