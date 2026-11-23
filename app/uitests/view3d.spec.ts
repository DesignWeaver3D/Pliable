import { expect, test } from "@playwright/test";
import { clickFace, clickableFaces, dragFace, emptySpot, modelView, openApp } from "./app.ts";

const size = (bounds: number[]) => [bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2]];
const volumeOfBox = (bounds: number[]) => size(bounds).reduce((a, b) => a * b, 1);

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("clicking a face selects it and names it; clicking empty space clears the selection", async ({ page }) => {
  const [face] = await clickableFaces(page);
  await clickFace(page, face);
  await expect.poll(async () => (await modelView(page)).selection).toEqual([{ kind: "face", id: face.id }]);
  await expect(page.locator("#selected")).toContainText(`face ${face.id}`);
  const empty = await emptySpot(page);
  await page.mouse.move(empty.x, empty.y);
  await page.mouse.click(empty.x, empty.y);
  await expect.poll(async () => (await modelView(page)).selection).toEqual([]);
});

test("a click with Ctrl or Cmd held adds a face to the selection", async ({ page }) => {
  const [first, second] = await clickableFaces(page);
  await clickFace(page, first);
  await clickFace(page, second, ["ControlOrMeta"]);
  await expect.poll(async () => (await modelView(page)).selection).toEqual([{ kind: "face", id: first.id }, { kind: "face", id: second.id }]);
});

test("the pointer over a face is reported as hovering it", async ({ page }) => {
  const [face] = await clickableFaces(page);
  await page.mouse.move(face.at.x - 3, face.at.y - 3);
  await page.mouse.move(face.at.x, face.at.y);
  await expect.poll(async () => (await modelView(page)).hovered).toEqual({ kind: "face", id: face.id });
});

test("dragging a selected face along its arrow pulls it out, and Undo puts it back", async ({ page }) => {
  const before = (await modelView(page)).bounds;
  const [face] = await clickableFaces(page);
  await clickFace(page, face);
  await dragFace(page, face, 60);
  await expect.poll(async () => (await modelView(page)).canUndo).toBe(true);
  const pulled = (await modelView(page)).bounds;
  expect(volumeOfBox(pulled)).toBeGreaterThan(volumeOfBox(before) * 1.01);
  await page.locator("#undo").click();
  await expect.poll(async () => size((await modelView(page)).bounds).map((n) => Math.round(n * 1000))).toEqual(size(before).map((n) => Math.round(n * 1000)));
});
