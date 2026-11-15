import test from "node:test";
import assert from "node:assert/strict";
import { TimingLog, summarize, sumCoreMs, requestLine } from "../src/devtiming.ts";

const make = () => {
  let t = 0;
  const lines = [];
  const frames = [];
  const log = new TimingLog(() => t, (l) => lines.push(l), (cb) => frames.push(cb));
  return { log, lines, frames, at: (v) => (t = v) };
};

test("a disabled log records nothing", () => {
  const { log, lines } = make();
  log.sent(1, "x");
  log.replied(1, { arrivedAt: 5, decodeMs: 1, applyMs: 1, bytes: 1 });
  assert.equal(log.requests.length, 0);
  assert.equal(lines.length, 0);
});

test("a request is timed from send to reply and counts the requests waiting", () => {
  const { log, lines, at } = make();
  log.enabled = true;
  at(10);
  log.sent(1, "related");
  log.sent(2, "tool_handles");
  log.replied(1, { arrivedAt: 110, decodeMs: 2, applyMs: 3, bytes: 500, timings: { opMs: 40, meshMs: 20, note: "x" } });
  assert.equal(log.requests[0].coreMs, 60);
  assert.equal(log.requests[0].waiting, 1);
  log.replied(2, { arrivedAt: 120, decodeMs: 0, applyMs: 0, bytes: 1 });
  assert.equal(log.requests[1].waiting, 2);
  assert.match(lines[0], /related#1 .* round-trip 100 core 60 decode 2 apply 3 bytes 500 waiting 1/);
});

test("a reply without timings has no core time", () => {
  assert.equal(sumCoreMs(undefined), null);
  assert.equal(sumCoreMs({ a: "x" }), null);
  assert.match(requestLine({ id: 1, type: "t", sent: 0, arrived: 1, decodeMs: 0, applyMs: 0, bytes: 0, coreMs: null, waiting: 1 }), /core \?/);
});

test("a shown mesh gets its frame times from the next two frames", () => {
  const { log, lines, frames, at } = make();
  log.enabled = true;
  at(150);
  log.shown(100, 110, 150, false, 99); // show began at 100 and ended (now) at 150; the scene rebuild took 40
  assert.equal(log.shows[0].setMeshMs, 40);
  assert.equal(log.shows[0].otherMs, 10);
  at(180);
  frames.shift()();
  at(195);
  frames.shift()();
  assert.equal(log.shows[0].toFrameMs, 30);
  assert.equal(log.shows[0].frameMs, 15);
  assert.match(lines.at(-1), /show at 100 setMesh 40 other 10 toFrame 30 frame 15 tris 99/);
});

test("a step sums only what started after it began", () => {
  const { log, at } = make();
  log.enabled = true;
  at(1);
  log.sent(1, "old");
  log.replied(1, { arrivedAt: 2, decodeMs: 0, applyMs: 0, bytes: 10 });
  at(50);
  log.step("move");
  log.sent(2, "tool_preview");
  log.replied(2, { arrivedAt: 80, decodeMs: 4, applyMs: 6, bytes: 100, timings: { opMs: 20 } });
  at(90);
  const s = summarize(log.requests, log.shows, 50);
  assert.equal(s.requests, 1);
  assert.equal(s.roundTripMs, 30);
  assert.equal(s.coreMs, 20);
  assert.deepEqual(s.byType, { tool_preview: 1 });
  assert.match(log.endStep(), /step "move" 40 ms: 1 requests \(tool_previewx1\)/);
});
