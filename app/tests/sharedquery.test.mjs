import test from "node:test";
import assert from "node:assert/strict";
import { SharedQueries } from "../src/sharedquery.ts";

const gate = () => {
  let open;
  const wait = new Promise((r) => (open = r));
  return { wait, open };
};

test("an identical question asked while one is open shares its answer and is sent once", async () => {
  const shared = new SharedQueries();
  const g = gate();
  let sent = 0;
  const ask = () => shared.share("related:{}", () => (sent++, g.wait.then(() => ({ rules: [] }))));
  const a = ask();
  const b = ask();
  assert.equal(a, b);
  g.open();
  assert.deepEqual(await a, { rules: [] });
  assert.equal(sent, 1);
});

test("a question asked after the answer came, or with other parameters, is sent again", async () => {
  const shared = new SharedQueries();
  let sent = 0;
  const ask = (key) => shared.share(key, async () => ++sent);
  await ask("measure:a");
  await ask("measure:a");
  await Promise.all([ask("measure:b"), ask("measure:c")]);
  assert.equal(sent, 4);
});

test("forgetting what is open makes the next identical question a new one, and a failed question is not kept", async () => {
  const shared = new SharedQueries();
  const g = gate();
  let sent = 0;
  const first = shared.share("k", () => (sent++, g.wait));
  shared.forget();
  shared.share("k", async () => ++sent);
  assert.equal(sent, 2);
  g.open();
  await first;
  await assert.rejects(shared.share("bad", () => Promise.reject(new Error("no"))));
  await shared.share("bad", async () => sent++);
  assert.equal(sent, 3);
});
