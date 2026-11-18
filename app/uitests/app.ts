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

/** What the development-only hook reports about the open sketch (app/src/testhook.ts). */
export interface SketchView {
  tool: string;
  dragging: boolean;
  curves: { id: number; type: string; construction: boolean; selected: boolean; hovered: boolean; highlighted: boolean; layers: { name: string; dashed: boolean; color: string; width: number }[]; at: { x: number; y: number } }[];
  points: { id: number; selected: boolean; at: { x: number; y: number } }[];
}

type Spot = { x: number; y: number };
type Item = { kind: string; id: number };

/** What the hook reports about the model in the 3D view (app/src/testhookmodel.ts). */
export interface ModelView {
  faces: { id: number; body: number | null }[];
  bounds: number[];
  selection: Item[];
  hovered: Item | null;
  canUndo: boolean;
  canRedo: boolean;
}

type Hooked = {
  __pliableTest: {
    sketch(): SketchView | null;
    sketchToScreen(u: number, v: number): Spot;
    model(): ModelView | null;
    pickAt(x: number, y: number): Item | null;
    faceToScreen(id: number): Spot | null;
    faceNormalOnScreen(id: number, at: Spot): Spot | null;
  };
};

/** The open sketch as the canvas hook reports it. */
export async function sketchView(page: Page): Promise<SketchView> {
  const view = await page.evaluate(() => (window as unknown as Hooked).__pliableTest.sketch());
  if (!view) throw new Error("No sketch is open");
  return view;
}

/** Where a place on the sketch plane is in the page. Fails if a panel or toolbar covers the canvas there: a click would never reach the sketch. */
export async function sketchToScreen(page: Page, u: number, v: number): Promise<{ x: number; y: number }> {
  const { x, y, under } = await page.evaluate(([a, b]) => {
    const at = (window as unknown as Hooked).__pliableTest.sketchToScreen(a, b);
    return { ...at, under: document.elementFromPoint(at.x, at.y)?.tagName ?? "nothing" };
  }, [u, v]);
  expect(under, `the sketch place (${u}, ${v}) is covered or off screen`).toBe("CANVAS");
  return { x, y };
}

/** Click a place on the sketch plane with the mouse. */
export async function clickSketch(page: Page, u: number, v: number): Promise<void> {
  const at = await sketchToScreen(page, u, v);
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);
}

/** Choose a sketch tool or constraint by the name on its button. */
export async function sketchTool(page: Page, name: string): Promise<void> {
  await page.locator("#tools button", { hasText: new RegExp(`^${name}$`) }).click();
}

/** Draw one line with the mouse between two places on the sketch plane, then go back to Select. Returns the new curve's id. */
export async function drawLine(page: Page, from: [number, number], to: [number, number]): Promise<number> {
  const before = (await sketchView(page)).curves.map((c) => c.id);
  await sketchTool(page, "Line");
  for (const [u, v] of [from, to]) await clickSketch(page, u, v);
  await page.keyboard.press("Escape");
  await sketchTool(page, "Select");
  const added = (await sketchView(page)).curves.filter((c) => !before.includes(c.id) && c.type === "line");
  expect(added, "one new line").toHaveLength(1);
  return added[0].id;
}

/** The hook's report for one curve. */
export async function curve(page: Page, id: number): Promise<SketchView["curves"][number]> {
  const found = (await sketchView(page)).curves.find((c) => c.id === id);
  if (!found) throw new Error(`The sketch has no curve ${id}`);
  return found;
}

/** Click a curve at its middle with the mouse. */
export async function clickCurve(page: Page, id: number): Promise<void> {
  const { at } = await curve(page, id);
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);
}

/** The model in the 3D view as the canvas hook reports it. */
export async function modelView(page: Page): Promise<ModelView> {
  const view = await page.evaluate(() => (window as unknown as Hooked).__pliableTest.model());
  if (!view) throw new Error("No model is loaded");
  return view;
}

/** A flat face that can be clicked now, where to click it, and how far one unit along its outward normal moves on screen. */
export interface FaceSpot {
  id: number;
  at: Spot;
  normal: Spot;
}

/** Every flat face with a place where a click reaches it (not hidden, not behind another face, not under a panel), widest-moving normal first. */
export async function clickableFaces(page: Page): Promise<FaceSpot[]> {
  const found = await page.evaluate(() => {
    const hook = (window as unknown as Hooked).__pliableTest;
    const out: FaceSpot[] = [];
    for (const face of hook.model()?.faces ?? []) {
      const at = hook.faceToScreen(face.id);
      const normal = at && hook.faceNormalOnScreen(face.id, at);
      if (at && normal && document.elementFromPoint(at.x, at.y)?.tagName === "CANVAS") out.push({ id: face.id, at, normal });
    }
    return out;
  });
  return found.sort((a, b) => Math.hypot(b.normal.x, b.normal.y) - Math.hypot(a.normal.x, a.normal.y));
}

/** Click a face with the mouse, with the keys in `held` down. */
export async function clickFace(page: Page, face: FaceSpot, held: string[] = []): Promise<void> {
  for (const key of held) await page.keyboard.down(key);
  await page.mouse.move(face.at.x, face.at.y);
  await page.mouse.click(face.at.x, face.at.y);
  for (const key of held) await page.keyboard.up(key);
}

/** A place on the canvas where a click picks nothing. */
export async function emptySpot(page: Page): Promise<Spot> {
  const spot = await page.evaluate(() => {
    const hook = (window as unknown as Hooked).__pliableTest;
    const box = document.querySelector("#viewport canvas")!.getBoundingClientRect();
    for (let fy = 0.9; fy > 0.1; fy -= 0.1) {
      for (let fx = 0.1; fx < 0.9; fx += 0.1) {
        const at = { x: box.left + box.width * fx, y: box.top + box.height * fy };
        if (document.elementFromPoint(at.x, at.y)?.tagName === "CANVAS" && hook.pickAt(at.x, at.y) === null) return at;
      }
    }
    return null;
  });
  if (!spot) throw new Error("No empty place on the canvas");
  return spot;
}

/** Press on a face and drag `pixels` along its outward normal as it appears on screen (a pull), in small steps like a hand. */
export async function dragFace(page: Page, face: FaceSpot, pixels: number): Promise<void> {
  const length = Math.hypot(face.normal.x, face.normal.y);
  await page.mouse.move(face.at.x, face.at.y);
  await page.mouse.down();
  await page.mouse.move(face.at.x + (face.normal.x / length) * pixels, face.at.y + (face.normal.y / length) * pixels, { steps: 10 });
  await page.mouse.up();
}
