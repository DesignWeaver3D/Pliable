/** Parts of the sketch card that only read and change the sketch: the drawing tool's options and the constraint list.
 *  Moved out of sketch.ts; `SketchMode` is the context. */
import * as Chk from "./sketchcheck";
import * as M from "./sketchmodel";
import type { SketchOptions, Tool } from "./sketch";

export interface PanelContext {
  s: M.SketchData;
  selection: M.SketchSel[];
  highlight: M.SketchSel[];
  failed: Set<number>;
  showMarks: boolean;
  options: SketchOptions;
  rectOptions: { corner: "none" | "fillet" | "chamfer"; size: number };
  tool: Tool;
  saveOptions(): void;
  pushUndo(): void;
  resolve(): Promise<boolean>;
  render(panel?: boolean): void;
  lightUp(c: M.SketchConstraint | null): void;
  editDimension(id: number): Promise<void>;
  toggleReference(id: number): Promise<void>;
  status(text: string, error?: boolean | "warn"): void;
}

export const el = (tag: string, cls = "", text = "") => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

export const button = (label: string, on: () => void, cls = "") => {
  const b = el("button", cls, label) as HTMLButtonElement;
  b.addEventListener("click", on);
  return b;
};

/** The options of the drawing tool chosen in the top bar (polygon sides, rectangle corners). */
export function buildToolOptions(ctx: PanelContext): HTMLElement {
  const tools = el("div", "row-buttons"); // options of the drawing tool chosen in the top bar

  if (ctx.tool === "polygon") {
    const sides = document.createElement("input");
    sides.type = "number";
    sides.min = "3";
    sides.max = "64";
    sides.step = "1";
    sides.value = String(ctx.options.sides);
    sides.title = "Number of sides (3 to 64)";
    sides.addEventListener("keydown", (e) => e.stopPropagation());
    sides.addEventListener("change", () => {
      const n = Math.round(Number(sides.value));
      if (Number.isFinite(n)) ctx.options.sides = Math.min(64, Math.max(3, n));
      sides.value = String(ctx.options.sides);
      ctx.saveOptions();
    });
    const row = el("label", "", "Sides ");
    row.append(sides);
    tools.append(row);
  }
  if (ctx.tool === "rectangle" || ctx.tool === "rectcentre") {
    const corner = document.createElement("select");
    for (const [v, label] of [["none", "Square corners"], ["fillet", "Rounded corners"], ["chamfer", "Bevelled corners"]]) corner.append(new Option(label, v, false, v === ctx.rectOptions.corner));
    corner.addEventListener("change", () => (ctx.rectOptions.corner = corner.value as "none" | "fillet" | "chamfer"));
    const size = document.createElement("input");
    size.type = "number";
    size.step = "any";
    size.min = "0";
    size.value = String(ctx.rectOptions.size);
    size.title = "Corner radius or bevel size";
    size.addEventListener("keydown", (e) => e.stopPropagation());
    size.addEventListener("input", () => (ctx.rectOptions.size = Math.abs(Number(size.value)) || 0));
    const row = el("div", "row-buttons");
    row.append(corner, size);
    tools.append(row);
  }
  return tools;
}

/** The "Constraints" section: counts, mark toggle, checks and one row per constraint. */
export function buildConstraintList(ctx: PanelContext): HTMLElement {
  const list = el("div", "section");
  const autos = ctx.s.constraints.filter((c) => c.auto);
  list.append(el("div", "group", `Constraints (${ctx.s.constraints.length}${autos.length ? `, ${autos.length} automatic` : ""})`));
  const marks = button(ctx.showMarks ? "Hide marks" : "Show marks", () => {
    ctx.showMarks = !ctx.showMarks;
    ctx.render();
  });
  marks.title = "Show or hide the small tags (H, V, T, =, ...) that mark where constraints act";
  list.append(marks);
  const check = button("Check sketch", () => {
    ctx.selection = Chk.openEnds(ctx.s).map((id) => ({ kind: "point" as const, id }));
    ctx.status(Chk.describeProblems(ctx.s));
    ctx.render();
  });
  check.title = "Report points that nearly touch and line ends that meet nothing; the open ends are selected";
  const join = button("Join near points", async () => {
    const gaps = Chk.findGaps(ctx.s);
    if (!gaps.length) return ctx.status("No points nearly touch");
    ctx.pushUndo();
    ctx.s = Chk.joinGaps(ctx.s, gaps);
    ctx.selection = [];
    await ctx.resolve();
    ctx.status(`Joined ${gaps.length} pair${gaps.length === 1 ? "" : "s"} of points`);
    ctx.render();
  });
  join.title = "Merge points that are very close but not the same point, so outlines close";
  list.append(check, join);
  for (const c of ctx.s.constraints) {
    const row = el("div", ctx.failed.has(c.id) ? "crow bad" : "crow");
    row.append(el("span", "", M.describeConstraint(ctx.s, c) + (c.auto ? " (automatic)" : "")));
    row.title = c.auto ? "Added by a drawing tool. Hover to see what it holds; the x removes it so the geometry moves freely" : "Hover to see what it holds; the x removes it";
    row.addEventListener("pointerenter", () => ctx.lightUp(c));
    row.addEventListener("pointerleave", () => ctx.lightUp(null));
    if (c.value !== undefined) {
      const edit = button("✎", () => void ctx.editDimension(c.id));
      edit.title = c.reference ? "Make this a driving dimension again" : "Change the value";
      const ref = button(c.reference ? "Drive" : "Ref", () => void ctx.toggleReference(c.id));
      ref.title = c.reference ? "Make this dimension drive the shape" : "Keep only the measurement; the dimension stops driving the shape";
      row.append(...(c.reference ? [ref] : [edit, ref]));
    }
    const remove = button("✕", () => {
      ctx.pushUndo();
      ctx.s.constraints = ctx.s.constraints.filter((x) => x.id !== c.id);
      ctx.highlight = [];
      ctx.resolve();
      ctx.render();
    });
    remove.title = "Remove this constraint";
    row.append(remove);
    list.append(row);
  }
  if (autos.length) {
    const clear = button("Remove automatic constraints", () => {
      ctx.pushUndo();
      ctx.s.constraints = ctx.s.constraints.filter((x) => !x.auto);
      ctx.highlight = [];
      ctx.resolve();
      ctx.render();
    });
    clear.title = "Remove every constraint a drawing tool added (horizontal and vertical sides, snaps onto curves); constraints you added stay";
    list.append(clear);
  }
  return list;
}
