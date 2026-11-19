import { expect, test } from "@playwright/test";
import { addBox, faceCount, openApp } from "./app.ts";

test("the page opens with the sample model and nothing to undo", async ({ page }) => {
  await openApp(page);
  expect(await faceCount(page)).toBeGreaterThan(0);
  await expect(page.locator("#undo")).toBeDisabled();
  await expect(page.locator("#bodylist")).toContainText("Body 1");
});

test("an edit can be undone and redone from the top bar", async ({ page }) => {
  await openApp(page);
  const start = await faceCount(page);
  await addBox(page);
  const edited = await faceCount(page);
  await expect(page.locator("#undo")).toBeEnabled();
  await page.locator("#undo").click();
  await expect.poll(() => faceCount(page)).toBe(start);
  await page.locator("#redo").click();
  await expect.poll(() => faceCount(page)).toBe(edited);
});
