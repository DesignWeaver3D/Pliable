import { expect, test } from "@playwright/test";

// Runs once before the other tests. The core remembers that the alpha notice was read, so after this it is not shown again.
test("the alpha notice is shown on first use and stays closed once read", async ({ page }) => {
  await page.goto("/");
  const understand = page.getByRole("button", { name: "I understand" });
  await understand.click();
  await expect(understand).toBeHidden();
  await page.reload();
  await expect(page.locator("#status")).toContainText(/\d+ faces/);
  await expect(page.getByRole("button", { name: "Got it" })).toBeVisible();
  await expect(understand).toBeHidden();
});
