import { expect, test } from "@playwright/test";
import { addBox, openApp, startSketch } from "./app.ts";

test.beforeEach(async ({ page }) => {
  // Without the browser's own save dialog (which a test cannot answer) the page saves by downloading.
  await page.addInitScript(() => delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker);
});

test("the title marks unsaved work after an edit and clears when the project is saved", async ({ page }) => {
  await openApp(page);
  await expect(page).toHaveTitle("Pliable");
  await addBox(page);
  await expect(page).toHaveTitle("• Pliable");
  const download = page.waitForEvent("download");
  await page.locator("#menubtn").click();
  await page.locator("#saveproject").click();
  expect((await download).suggestedFilename()).toMatch(/\.plbl$/);
  await expect(page).toHaveTitle("Pliable");
  await addBox(page);
  await expect(page).toHaveTitle("• Pliable");
});

test("an open sketch counts as unsaved work until it is discarded", async ({ page }) => {
  await openApp(page);
  await startSketch(page);
  await expect(page).toHaveTitle("• Pliable");
  await page.locator("#sketchpanel button", { hasText: "Discard sketch" }).click();
  await expect(page).toHaveTitle("Pliable");
});
