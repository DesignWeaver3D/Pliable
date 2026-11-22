import { expect, test } from "@playwright/test";

// Runs once before the other tests. The core remembers that the alpha notice was read, so after this it is not shown again.
// A retry therefore finds the notice already read and only checks the part after the reload. The first start of the core can
// be slow on a busy machine, so the page gets longer than the usual 5 seconds to connect.
test("the alpha notice is shown on first use and stays closed once read", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.goto("/");
  const understand = page.getByRole("button", { name: "I understand" });
  if (testInfo.retry === 0) {
    await understand.click();
    await expect(understand).toBeHidden();
  }
  await page.reload();
  await expect(page.locator("#status")).toContainText(/\d+ faces/, { timeout: 45_000 });
  await expect(page.getByRole("button", { name: "Got it" })).toBeVisible();
  await expect(understand).toBeHidden();
});
