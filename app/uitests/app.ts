/** Steps the browser tests share: opening the page ready for use, and the common actions done through page controls. */
import { expect, type Page } from "@playwright/test";

/** Open the page with a fresh copy of the bracket sample and close the Getting started card (the alpha notice was read in
 *  firstrun.setup.ts). The core hands a reloaded page its previous session, so the sample is opened again to drop whatever
 *  an earlier test left: its edits and its undo history. */
export async function openApp(page: Page): Promise<void> {
  page.on("dialog", (dialog) => void dialog.accept()); // replacing an edited model asks first
  await page.goto("/");
  await expect(page.locator("#status")).toContainText(/\d+ faces/);
  await page.getByRole("button", { name: "Got it" }).click();
  await page.locator("#menubtn").click();
  await page.locator("#demo").selectOption("bracket");
  await expect(page.locator("#undo")).toBeDisabled();
  await expect(page.locator("#status")).toContainText(/bracket: \d+ faces/);
  if (await page.locator("#menupanel").isVisible()) await page.locator("#menubtn").click();
  await expect(page.locator("#menupanel")).toBeHidden();
}

/** The number of faces the status line reports for the model. */
export async function faceCount(page: Page): Promise<number> {
  const text = (await page.locator("#status").textContent()) ?? "";
  const found = /(\d+) faces/.exec(text);
  if (!found) throw new Error(`The status line does not report a face count: "${text}"`);
  return Number(found[1]);
}

/** Make one edit to the model with page controls only: add a box with the form's own values. */
export async function addBox(page: Page): Promise<void> {
  const before = await faceCount(page);
  await page.getByRole("button", { name: "Add box" }).click();
  await page.locator("#dockbody button:visible", { hasText: /^Apply$/ }).click();
  await expect.poll(() => faceCount(page).catch(() => before)).toBeGreaterThan(before);
}

/** Start a sketch on the XY plane. */
export async function startSketch(page: Page): Promise<void> {
  await page.locator("#sketchbar button", { hasText: /^XY$/ }).click();
  await expect(page.locator("#sketchpanel button", { hasText: "Finish sketch" })).toBeVisible();
}

/** Fail if the page's own code has stopped running (a frozen page never answers). */
export async function expectResponsive(page: Page): Promise<void> {
  const answered = await Promise.race([
    page.evaluate(() => new Promise<boolean>((done) => setTimeout(() => done(true), 50))),
    new Promise<boolean>((done) => setTimeout(() => done(false), 5000)),
  ]);
  expect(answered, "the page is frozen").toBe(true);
}
