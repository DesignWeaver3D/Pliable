/** The browser tests (uitests/): they drive the real page against a real core, each run with its own ports and an empty, temporary data folder. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const CORE_PORT = 8791;
const PAGE_PORT = 5291;
const ADDRESS = "127.0.0.1";

export default defineConfig({
  testDir: "./uitests",
  timeout: 30_000,
  workers: 1, // the tests share one core; one at a time keeps a failure easy to read
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://${ADDRESS}:${PAGE_PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "first run", testMatch: /firstrun\.setup\.ts/, use: { ...devices["Desktop Chrome"] } },
    { name: "chromium", dependencies: ["first run"], use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", dependencies: ["first run"], use: { ...devices["Desktop Safari"] } },
  ],
  webServer: [
    {
      command: `uv run pliable-server --host ${ADDRESS} --port ${CORE_PORT}`,
      cwd: "../core",
      port: CORE_PORT,
      env: { PLIABLE_DATA: mkdtempSync(join(tmpdir(), "pliable-uitests-")) },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx vite --host ${ADDRESS} --port ${PAGE_PORT} --strictPort`,
      port: PAGE_PORT,
      env: { VITE_CORE_PORT: String(CORE_PORT) },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
