/** Edits of the sketch selection: the transform buttons (move, rotate, scale, mirror, arrays), offset, corner rounding and construction. */
import * as E from "./sketchedit.ts";
import * as M from "./sketchmodel.ts";
import { roundAt } from "./sketchcorner.ts";
import { pushUndo } from "./sketchundo.ts";
import { resolveSketch } from "./sketchrefresh.ts";
import { renderSketch } from "./sketchrender.ts";
import type { SketchMode } from "./sketch.ts";

/** Replace the sketch with an edited one (move, copy, array) and settle it; a result the constraints refuse is undone. */
export async function applyEdit(mode: SketchMode, make: () => E.EditResult) {
  pushUndo(mode);
  const before = JSON.stringify(mode.s);
  const made = make();
  mode.s = made.sketch;
  mode.selection = made.selection;
  const ok = await resolveSketch(mode);
  if (!ok) {
    mode.s = JSON.parse(before);
    mode.undoStack.pop();
    mode.selection = [];
    await resolveSketch(mode);
    mode.host.status("The constraints do not allow that change, so it was not made", true);
  }
  renderSketch(mode);
}

export function transformButtons(mode: SketchMode): HTMLElement | null {
  if (!E.selected(mode.s, mode.selection).points.length) return null;
  const [cu, cv] = E.centroid(mode.s, mode.selection);
  const sel = [...mode.selection];
  const row = document.createElement("div");
  row.className = "row-buttons";
  const add = (label: string, tip: string, run: () => Promise<void> | void) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.title = tip;
    b.addEventListener("click", () => void run());
    row.append(b);
  };
  add("Move…", "Move the selection by a distance along the sketch axes, or copy it there", async () => {
    const a = await mode.askForm("Move", [{ label: "Across", value: 0 }, { label: "Up", value: 0 }], false);
    if (a) await applyEdit(mode, () => E.transform(mode.s, sel, E.translation(a.values[0], a.values[1]), { copy: a.copy }));
  });
  add("Rotate…", "Rotate the selection by an angle about a point (starts at its middle)", async () => {
    const a = await mode.askForm("Rotate", [{ label: "Degrees", value: 90 }, { label: "About across", value: cu }, { label: "About up", value: cv }], false);
    if (a) await applyEdit(mode, () => E.transform(mode.s, sel, E.rotation(a.values[0], a.values[1], a.values[2]), { copy: a.copy }));
  });
  add("Scale…", "Scale the selection about a point (starts at its middle)", async () => {
    const a = await mode.askForm("Scale", [{ label: "Factor", value: 2 }, { label: "About across", value: cu }, { label: "About up", value: cv }], false);
    if (a && a.values[0] > 0) await applyEdit(mode, () => E.transform(mode.s, sel, E.scaling(a.values[0], a.values[1], a.values[2]), { copy: a.copy, scale: a.values[0] }));
  });
  const lines = sel.filter((x) => x.kind === "entity" && M.entityOf(mode.s, x.id)?.type === "line");
  const rest = sel.filter((x) => !lines.length || x !== lines[lines.length - 1]);
  if (lines.length && E.selected(mode.s, rest).points.length) {
    const axis = lines[lines.length - 1].id;
    add("Mirror", "Add a mirror image of the selection across the last line you selected, kept symmetric by constraints", () => {
      const l = M.entityOf(mode.s, axis) as Extract<M.SketchEntity, { type: "line" }>;
      const [a, b] = [M.pointOf(mode.s, l.a), M.pointOf(mode.s, l.b)];
      return applyEdit(mode, () => E.transform(mode.s, rest, E.reflection(a.u, a.v, b.u - a.u, b.v - a.v), { copy: true, mirror: true, axis }));
    });
  }
  add("Mirror in horizontal axis", "Add a mirror image across the horizontal axis of the sketch", () =>
    applyEdit(mode, () => E.transform(mode.s, sel, E.reflection(0, 0, 1, 0), { copy: true, mirror: true })));
  add("Mirror in vertical axis", "Add a mirror image across the vertical axis of the sketch", () =>
    applyEdit(mode, () => E.transform(mode.s, sel, E.reflection(0, 0, 0, 1), { copy: true, mirror: true })));
  add("Row of copies…", "Repeat the selection in a row", async () => {
    const a = await mode.askForm("Row", [{ label: "Count", value: 3, integer: true }, { label: "Step across", value: 10 }, { label: "Step up", value: 0 }]);
    if (a && a.values[0] >= 2 && a.values[0] <= 200) await applyEdit(mode, () => E.repeat(mode.s, sel, Math.round(a.values[0]), (k) => ({ map: E.translation(k * a.values[1], k * a.values[2]) })));
  });
  add("Circle of copies…", "Repeat the selection around a center", async () => {
    const a = await mode.askForm("Around", [{ label: "Count", value: 6, integer: true }, { label: "Total degrees", value: 360 }, { label: "Center across", value: cu }, { label: "Center up", value: cv }]);
    if (!a || a.values[0] < 2 || a.values[0] > 200) return;
    const count = Math.round(a.values[0]);
    const full = Math.abs(a.values[1]) >= 360;
    const step = a.values[1] / (full ? count : count - 1);
    await applyEdit(mode, () => E.repeat(mode.s, sel, count, (k) => ({ map: E.rotation(k * step, a.values[2], a.values[3]) })));
  });
  return row;
}

/** Add parallel copies of the selected curves, `offset.distance` away (positive grows a closed outline). */
export async function offsetSelection(mode: SketchMode) {
  const ids = mode.selection.filter((x) => x.kind === "entity").map((x) => x.id);
  try {
    const made = await mode.core.request<{ points: M.SketchPoint[]; entities: M.SketchEntity[] }>("sketch_offset", { sketch: mode.s, entities: ids, distance: mode.offset.distance });
    pushUndo(mode);
    mode.s.points.push(...made.points);
    mode.s.entities.push(...made.entities);
    mode.selection = made.entities.map((e) => ({ kind: "entity" as const, id: e.id }));
    resolveSketch(mode);
    renderSketch(mode);
    mode.host.status(`Offset ${made.entities.length} curve${made.entities.length === 1 ? "" : "s"} by ${mode.offset.distance}`);
  } catch (e) {
    mode.host.status((e as Error).message, true);
  }
}

/** Round or bevel the selected corner (a point where two lines meet) with the rectangle corner size. */
export function roundSelectedCorner(mode: SketchMode, kind: "fillet" | "chamfer") {
  const point = mode.selection.find((x) => x.kind === "point");
  if (!point) return mode.host.status("Select the corner point first", true);
  const at = M.pointOf(mode.s, point.id); // no pointer to pick a side: the fillet nearest the corner itself
  const made = roundAt(mode.s, point.id, kind, mode.rectOptions.size, at.u, at.v);
  if (typeof made === "string") return mode.host.status(made, true);
  pushUndo(mode);
  mode.s = made;
  mode.selection = [];
  resolveSketch(mode);
  renderSketch(mode);
  mode.host.status(kind === "fillet" ? "Rounded the corner" : "Bevelled the corner");
}

/** Alt, or the card's button: each selected curve switches between regular and construction. */
export function toggleConstruction(mode: SketchMode) {
  const ids = new Set(mode.selection.filter((x) => x.kind === "entity").map((x) => x.id));
  if (!ids.size) return;
  pushUndo(mode);
  for (const en of mode.s.entities) if (ids.has(en.id)) en.construction = !en.construction;
  renderSketch(mode);
}
