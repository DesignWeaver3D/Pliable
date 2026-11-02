import test from "node:test";
import assert from "node:assert/strict";
import { TypedFields, typedCounts } from "../src/typedentry.ts";

const type = (fields, keys) => keys.forEach((k) => fields.key(k));

test("digits, a decimal point and operators make a formula; Backspace edits", () => {
  const f = new TypedFields(1);
  type(f, ["1", "2", ".", "5"]);
  assert.equal(f.value(0), 12.5);
  type(f, ["Backspace", "Backspace"]);
  assert.equal(f.value(0), 12);
  f.key("-");
  assert.equal(f.value(0), null); // "12-" is not finished
  type(f, ["4"]);
  assert.equal(f.value(0), 8); // a minus inside the text is subtraction
  assert.equal(f.shown(0, "x"), "12-4|");
});

test("a minus typed first makes the number negative, and a formula is calculated", () => {
  const f = new TypedFields(1);
  type(f, ["-", "5"]);
  assert.equal(f.value(0), -5);
  type(f, ["*", "(", "1", "+", "1", ")"]);
  assert.equal(f.value(0), -10);
});

test("Tab moves between fields and each keeps its own text", () => {
  const f = new TypedFields(2, true);
  type(f, ["4", "Tab", "7", "Tab", "5"]);
  assert.equal(f.value(0), 45);
  assert.equal(f.value(1), 7);
  assert.equal(f.shown(0, "x"), "45|");
  assert.equal(f.shown(1, "x"), "7");
  assert.equal(new TypedFields(1).key("Tab"), false);
});

test("counts take digits only and untouched fields keep the current count", () => {
  const f = new TypedFields(2, true);
  assert.equal(f.key("-"), false);
  assert.equal(f.key("."), false);
  type(f, ["5"]);
  assert.deepEqual(typedCounts(f, { columns: 3, rows: 4 }), { columns: 5, rows: 4 });
  type(f, ["Tab", "0"]);
  assert.deepEqual(typedCounts(f, { columns: 3, rows: 4 }), { columns: 5, rows: 1 }); // at least one
});
