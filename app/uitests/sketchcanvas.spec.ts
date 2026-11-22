import { expect, test, type Page } from "@playwright/test";
import { clickCurve, clickSketch, curve, drawLine, openApp, startSketch } from "./app.ts";

const SELECTION_ORANGE = "ff8a1f";

/** Click a place on the sketch plane where nothing is drawn, which clears the selection. */
const clickEmpty = (page: Page) => clickSketch(page, -50, -10);

const toggleConstruction = (page: Page) => page.locator("#sketchpanel button", { hasText: "Toggle construction" }).click();

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await startSketch(page);
});

test("a line drawn with the mouse is a normal, solid curve", async ({ page }) => {
  const line = await curve(page, await drawLine(page, [-40, -30], [-10, -45]));
  expect(line.construction).toBe(false);
  expect(line.selected).toBe(false);
  expect(line.layers).toEqual([expect.objectContaining({ name: "normal", dashed: false })]);
});

test("clicking a line selects it and draws it in the selection color; clicking empty space clears that", async ({ page }) => {
  const id = await drawLine(page, [-40, -30], [-10, -45]);
  await clickCurve(page, id);
  const selected = await curve(page, id);
  expect(selected.selected).toBe(true);
  expect(selected.layers).toEqual([expect.objectContaining({ color: SELECTION_ORANGE, dashed: false })]);
  await clickEmpty(page);
  await expect.poll(async () => (await curve(page, id)).selected).toBe(false);
  await expect.poll(async () => (await curve(page, id)).layers).toEqual([expect.objectContaining({ name: "normal" })]);
});

test("a line made construction is drawn dashed once it is no longer selected", async ({ page }) => {
  const id = await drawLine(page, [-40, -30], [-10, -45]);
  await clickCurve(page, id);
  await toggleConstruction(page);
  await clickEmpty(page);
  expect((await curve(page, id)).construction).toBe(true);
  await expect.poll(async () => (await curve(page, id)).layers).toEqual([expect.objectContaining({ name: "construction", dashed: true })]);
});

// A selected construction line was drawn solid, like a normal one (issue 6).
test("a selected construction line stays dashed, in the selection color", async ({ page }) => {
  const id = await drawLine(page, [-40, -30], [-10, -45]);
  await clickCurve(page, id);
  await toggleConstruction(page);
  const line = await curve(page, id);
  expect(line.construction).toBe(true);
  expect(line.selected).toBe(true);
  expect(line.layers).toEqual([expect.objectContaining({ color: SELECTION_ORANGE, dashed: true })]);
  await toggleConstruction(page); // back to a normal line: solid again, still selected
  expect((await curve(page, id)).layers).toEqual([expect.objectContaining({ color: SELECTION_ORANGE, dashed: false })]);
});
