/** Parts of the sketch card that only read and change the sketch: the drawing tool's options and the constraint list.
 *  Moved out of sketch.ts; `SketchMode` is the context. */
import * as Chk from "./sketchcheck";
import * as M from "./sketchmodel";
import * as Co from "./sketchcoincident";
import { uiIcon } from "./icons";
import { deleteButton } from "./deletebutton";
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
  if (ctx.tool === "fillet" || ctx.tool === "chamfer") {
    const size = document.createElement("input");
    size.type = "number";
    size.step = "any";
    size.min = "0";
    size.value = String(ctx.rectOptions.size);
    size.title = ctx.tool === "fillet" ? "Fillet radius" : "Chamfer distance along each side";
    size.addEventListener("keydown", (e) => e.stopPropagation());
    size.addEventListener("input", () => (ctx.rectOptions.size = Math.abs(Number(size.value)) || 0));
    const row = el("label", "", ctx.tool === "fillet" ? "Radius " : "Distance ");
    row.append(size);
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
  const list = el("div", "section cons");
  const rows = el("div", "crows"); // the rows scroll on their own while the buttons stay in place
  // Points where drawn curves meet are listed as automatic coincident rows (a negative id marks them); with a selection only its own rows show.
  const everything = [...ctx.s.constraints, ...Co.sharedAsConstraints(ctx.s)];
  const shown = Co.constraintsFor(ctx.s, everything, ctx.selection);
  const autos = everything.filter((c) => c.auto);
  list.append(el("div", "group", `Constraints (${shown.length === everything.length ? everything.length : `${shown.length} of ${everything.length}`}${autos.length ? `, ${autos.length} automatic` : ""})`));
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
  list.append(check, join, rows);
  for (const c of shown) {
    const row = el("div", ctx.failed.has(c.id) ? "crow bad" : "crow");
    row.append(el("span", "", M.describeConstraint(ctx.s, c) + (c.auto ? " (automatic)" : "")));
    row.title = c.id < 0 ? "Drawn curves share this end point. Hover to see what it holds; the trash can splits it so each curve has its own end" : c.auto ? "Added by a drawing tool. Hover to see what it holds; the trash can removes it so the geometry moves freely" : "Hover to see what it holds; the bin removes it";
    row.addEventListener("pointerenter", () => ctx.lightUp(c));
    row.addEventListener("pointerleave", () => ctx.lightUp(null));
    if (c.value !== undefined) {
      const edit = button("✎", () => void ctx.editDimension(c.id));
      edit.title = c.reference ? "Make this a driving dimension again" : "Change the value";
      const ref = el("button", "iconbtn");
      ref.append(uiIcon(c.reference ? "drivingDim" : "referenceDim"));
      ref.addEventListener("click", () => void ctx.toggleReference(c.id));
      ref.title = c.reference ? "Make this dimension drive the shape" : "Keep only the measurement; the dimension stops driving the shape (reference)";
      row.append(...(c.reference ? [ref] : [edit, ref]));
    }
    const remove = deleteButton(c.id < 0 ? "Split this shared end point so the curves can move apart" : "Remove this constraint", () => {
      ctx.pushUndo();
      if (c.id < 0) ctx.s = Co.splitPoint(ctx.s, -c.id);
      else ctx.s.constraints = ctx.s.constraints.filter((x) => x.id !== c.id);
      ctx.highlight = [];
      ctx.resolve();
      ctx.render();
    }, "iconbtn");
    row.append(remove);
    rows.append(row);
  }
  if (ctx.s.constraints.some((c) => c.auto)) {
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
