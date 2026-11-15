import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MeshStore } from "../src/meshstore.ts";
import { compareMeshes, readFrame } from "../src/meshframe.ts";
import { decodeMesh } from "../src/client.ts";

// Real frames from the core (core/scripts/make_delta_frames.py): every body, a one-body move, a delete of a middle body, the undo, and a whole frame after it.
const raw = JSON.parse(readFileSync(new URL("./fixtures/delta_frames.json", import.meta.url), "utf8"));
const frame = (name) => {
  const b = Buffer.from(raw[name], "base64");
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const headerOf = (name) => JSON.parse(new TextDecoder().decode(new Uint8Array(frame(name), 4, new DataView(frame(name)).getUint32(0, true))));

test("the frames of a delta connection join to the mesh of a whole frame after each step", () => {
  const store = new MeshStore();
  for (const step of ["first", "move", "delete", "undo"]) {
    const read = readFrame(frame(step), store);
    assert.ok("mesh" in read, step);
    if (step === "undo") assert.equal(compareMeshes(read.mesh, decodeMesh(frame("whole"))), null);
  }
});

test("a delta frame carries only the changed bodies, and a delete renumbers the later ones", () => {
  const changed = (name) => headerOf(name).delta.bodies.filter((b) => b.data).length;
  assert.equal(changed("first"), 4);
  assert.equal(changed("move"), 1);
  assert.equal(changed("delete"), 0);
  assert.equal(changed("undo"), 1);
  const store = new MeshStore();
  const first = readFrame(frame("first"), store).mesh;
  readFrame(frame("move"), store);
  const after = readFrame(frame("delete"), store).mesh;
  assert.ok(after.faces.length < first.faces.length);
  assert.equal(Math.max(...after.faces.map((f) => f.id)), after.faces.length - 1);
});

test("a delta that does not follow what the store holds asks for a whole reply", () => {
  const store = new MeshStore();
  const read = readFrame(frame("move"), store); // the store never saw the first frame
  assert.ok("needFull" in read);
  assert.ok("mesh" in readFrame(frame("first"), store)); // a base-less frame fills it again
});

test("a whole frame empties the store and a connection without a store reads frames as before", () => {
  const store = new MeshStore();
  readFrame(frame("first"), store);
  assert.ok("mesh" in readFrame(frame("whole"), store));
  assert.equal(store.version, null);
  assert.ok("needFull" in readFrame(frame("move"), store));
  assert.equal(readFrame(frame("whole"), null).mesh.faces.length, decodeMesh(frame("whole")).faces.length);
});

test("the comparison names what differs", () => {
  const a = decodeMesh(frame("whole"));
  const b = decodeMesh(frame("whole"));
  assert.equal(compareMeshes(a, b), null);
  b.positions[0] += 1;
  assert.equal(compareMeshes(a, b), "positions");
  b.positions[0] -= 1;
  b.faces[0].count += 1;
  assert.equal(compareMeshes(a, b), "faces");
});
