import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Source text saved through the wrong encoding turns "°" into two characters (an A with a circumflex, then the sign),
 *  which then shows in unit labels. This has happened twice, so the sources are checked for it. */
const SRC = new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const GARBLED = /[ÂÃ][\u0080-¿]|�/;

test("no source file holds text garbled by a wrong encoding", () => {
  const bad = [];
  for (const f of readdirSync(SRC)) {
    if (!f.endsWith(".ts")) continue;
    readFileSync(join(SRC, f), "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (GARBLED.test(line)) bad.push(`${f}:${i + 1}`);
      });
  }
  assert.deepEqual(bad, []);
});
