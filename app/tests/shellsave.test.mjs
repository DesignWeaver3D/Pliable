import test from "node:test";
import assert from "node:assert/strict";
import { shellReportsSaves, shellSaveOutcome } from "../src/shellsave.ts";

const settled = async (promise) => Promise.race([promise.then((v) => ({ done: true, value: v })), new Promise((r) => setTimeout(() => r({ done: false }), 20))]);

test("only a window the shell has marked waits for the shell's report", () => {
  assert.equal(shellReportsSaves({}), false);
  assert.equal(shellReportsSaves({ __pliableShellSaves: true }), true);
});

test("a save counts only when the shell reports the file was written", async () => {
  const w = { __pliableShellSaves: true };
  const written = shellSaveOutcome(w, "part.plbl");
  w.__pliableDownloadSaved("part.plbl", true);
  assert.equal(await written, true);
  const cancelled = shellSaveOutcome(w, "part.plbl");
  w.__pliableDownloadSaved("part.plbl", false);
  assert.equal(await cancelled, false);
});

test("with no report the outcome stays open, so nothing is taken as saved", async () => {
  const w = { __pliableShellSaves: true };
  assert.deepEqual(await settled(shellSaveOutcome(w, "never.plbl")), { done: false });
});

test("a report for another file does not answer this one, and same-named saves are answered in order", async () => {
  const w = { __pliableShellSaves: true };
  const first = shellSaveOutcome(w, "a.plbl");
  const second = shellSaveOutcome(w, "a.plbl");
  w.__pliableDownloadSaved("b.plbl", true);
  assert.deepEqual(await settled(first), { done: false });
  w.__pliableDownloadSaved("a.plbl", false);
  w.__pliableDownloadSaved("a.plbl", true);
  assert.equal(await first, false);
  assert.equal(await second, true);
});
