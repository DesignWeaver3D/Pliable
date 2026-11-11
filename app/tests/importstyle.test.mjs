import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Relative imports in src carry the .ts extension. Node loads a module for a test without a bundler, and it cannot
 *  resolve "./name" by itself, so one bare import anywhere in a module's import chain makes that module untestable. */
const SRC = new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

test("relative imports in src name the .ts file", () => {
  const bare = [];
  for (const f of readdirSync(SRC)) {
    if (!f.endsWith(".ts")) continue;
    const text = readFileSync(join(SRC, f), "utf8");
    for (const m of text.matchAll(/(?:\bfrom |\bimport\()"\.\/([\w-]+)"/g)) {
      if (existsSync(join(SRC, m[1] + ".ts"))) bare.push(`${f}: "./${m[1]}"`);
    }
  }
  assert.deepEqual(bare, [], 'Write the import as "./name.ts"');
});
