import test from "node:test";
import assert from "node:assert/strict";
import { createPacer } from "../src/pacer.ts";

/** A clock the test moves by hand; `wait` resolves at once and records how long was asked for. */
function clock() {
  const state = { time: 0, waits: [] };
  return {
    state,
    now: () => state.time,
    wait: async (ms) => {
      state.waits.push(ms);
      state.time += ms;
    },
  };
}

const task = (c, cost, value) => async () => {
  c.state.time += cost;
  return value;
};

test("a quick follow-up runs at once, every time", async () => {
  const c = clock();
  const pacer = createPacer(100, 300, c.now, c.wait);
  assert.equal(await pacer.run(() => true, task(c, 10, "a")), "a");
  assert.equal(await pacer.run(() => true, task(c, 10, "b")), "b");
  assert.deepEqual(c.state.waits, []);
  assert.equal(pacer.slow, false);
});

test("after a slow run the next one waits for a pause first", async () => {
  const c = clock();
  const pacer = createPacer(100, 300, c.now, c.wait);
  await pacer.run(() => true, task(c, 900, "slow"));
  assert.equal(pacer.slow, true);
  assert.equal(await pacer.run(() => true, task(c, 900, "again")), "again");
  assert.deepEqual(c.state.waits, [300]);
});

test("a run made stale while it waits never starts", async () => {
  const c = clock();
  const pacer = createPacer(100, 300, c.now, c.wait);
  await pacer.run(() => true, task(c, 900, "slow"));
  let started = false;
  const result = await pacer.run(
    () => false,
    async () => {
      started = true;
    },
  );
  assert.equal(result, undefined);
  assert.equal(started, false);
  assert.equal(pacer.slow, true); // still slow: the skipped run measured nothing
});

test("it runs at once again when the follow-up is quick again", async () => {
  const c = clock();
  const pacer = createPacer(100, 300, c.now, c.wait);
  await pacer.run(() => true, task(c, 900, "slow"));
  await pacer.run(() => true, task(c, 20, "quick"));
  assert.equal(pacer.slow, false);
  await pacer.run(() => true, task(c, 20, "quick"));
  assert.deepEqual(c.state.waits, [300]);
});

test("a failing task still counts its time and passes the error on", async () => {
  const c = clock();
  const pacer = createPacer(100, 300, c.now, c.wait);
  await assert.rejects(
    pacer.run(
      () => true,
      async () => {
        c.state.time += 500;
        throw new Error("no");
      },
    ),
  );
  assert.equal(pacer.slow, true);
});
