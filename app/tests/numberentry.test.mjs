import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Typed numbers must go through parseNumber / allowedChars (numberformat.ts) so the decimal setting reaches every entry.
 *  This counts the ways around it per file. The counts may only go down: converting a file lowers its count, and a new
 *  bypass (or a new file with one) fails here. After converting, refresh the record with UPDATE_BASELINE=1. */
const PATTERNS = [/type = "number"/g, /type="number"/g, /(?<![A-Za-z])parseFloat\(/g, /(?<![A-Za-z])parseInt\(/g, /(?<![A-Za-z])Number\(/g, /valueAsNumber/g];
const SRC = new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const BASELINE = new URL("./numberentry.baseline.json", import.meta.url);

function count() {
  const out = {};
  for (const f of readdirSync(SRC)) {
    if (!f.endsWith(".ts") || f === "numberformat.ts") continue;
    const text = readFileSync(join(SRC, f), "utf8");
    let n = 0;
    for (const p of PATTERNS) n += (text.match(p) ?? []).length;
    if (n) out[f] = n;
  }
  return out;
}

test("no new way around the shared number parsing", () => {
  const now = count();
  if (process.env.UPDATE_BASELINE) writeFileSync(BASELINE, JSON.stringify(now, null, 2) + "\n");
  const base = JSON.parse(readFileSync(BASELINE, "utf8"));
  const more = Object.keys(now).filter((f) => now[f] > (base[f] ?? 0)).map((f) => `${f}: ${now[f]} (allowed ${base[f] ?? 0})`);
  assert.deepEqual(more, [], "Typed numbers go through parseNumber in numberformat.ts, not parseFloat/Number/type=number");
  const fewer = Object.keys(base).filter((f) => (now[f] ?? 0) < base[f]).map((f) => f);
  assert.deepEqual(fewer, [], "Converted: refresh the record with UPDATE_BASELINE=1 so the count stays tight");
});
