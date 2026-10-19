import test from "node:test";
import assert from "node:assert/strict";
import { LatestWins } from "../src/latestwins.ts";

const gate = () => {
  let open;
  const wait = new Promise((r) => (open = r));
  return { wait, open };
};

test("only the newest request waits while one runs, and runs never overlap", async () => {
  const log = [];
  let active = 0;
  let overlapped = false;
  const gates = [gate(), gate()];
  const runner = new LatestWins(async (value) => {
    active++;
    overlapped ||= active > 1;
    log.push(value);
    await gates[log.length - 1]?.wait;
    active--;
  });
  runner.push(1);
  runner.push(2);
  runner.push(3);
  runner.push(4);
  assert.equal(runner.busy, true);
  gates[0].open();
  await new Promise((r) => setTimeout(r, 5));
  gates[1].open();
  await runner.cancel();
  assert.deepEqual(log, [1, 4]); // 2 and 3 were replaced before they could run
  assert.equal(overlapped, false);
  assert.equal(runner.busy, false);
});

test("cancelling drops the waiting request and marks the running one stale", async () => {
  const first = gate();
  const seen = [];
  const runner = new LatestWins(async (value, current) => {
    if (value === "a") await first.wait;
    seen.push([value, current()]);
  });
  runner.push("a");
  runner.push("b");
  const cancelled = runner.cancel();
  first.open();
  await cancelled;
  assert.deepEqual(seen, [["a", false]]);
  runner.push("c");
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(seen.at(-1), ["c", true]); // a request made after the cancel is wanted again
});

test("a run that throws does not stop the next one", async () => {
  const ran = [];
  const runner = new LatestWins(async (value) => {
    ran.push(value);
    if (value === 1) throw new Error("boom");
  });
  runner.push(1);
  runner.push(2);
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(ran, [1, 2]);
});
