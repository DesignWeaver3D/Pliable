import { expect, test } from "@playwright/test";
import { expectResponsive, openApp, startSketch } from "./app.ts";

test("a sketch can be started and discarded", async ({ page }) => {
  await openApp(page);
  await startSketch(page);
  await page.locator("#sketchpanel button", { hasText: "Discard sketch" }).click();
  await expect(page.locator("#sketchbar button", { hasText: /^XY$/ })).toBeVisible();
  await expectResponsive(page);
});

test("choosing Dimension with nothing selected shows an orange warning", async ({ page }) => {
  await openApp(page);
  await startSketch(page);
  await page.locator("#tools button", { hasText: /^Dimension$/ }).click();
  await expect(page.locator("#status")).toHaveClass(/warn/);
  await expect(page.locator("#status")).toContainText("Select geometry to dimension or constrain");
});

// The page froze here: an unread sketch warning followed by a plain sketch message (issue 5).
test("finishing a sketch while a warning is unread leaves the page responsive", async ({ page }) => {
  await openApp(page);
  await startSketch(page);
  await page.locator("#tools button", { hasText: /^Dimension$/ }).click();
  await expect(page.locator("#status")).toHaveClass(/warn/);
  await page.locator("#sketchpanel button", { hasText: "Finish sketch" }).click({ noWaitAfter: true });
  await expectResponsive(page);
  await expect(page.locator("#status")).toHaveClass(/warn/); // the unread warning is still shown
});
