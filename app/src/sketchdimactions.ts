/** Actions on a sketch dimension: typing its value in place, dragging it, its menu, and switching it between driving and reference. */
import { equalChain } from "./sketchequalchain.ts";
import * as M from "./sketchmodel.ts";
import { chooseAtCursor } from "./sketchmenu.ts";
import { axesToFixed, fixedToAxes } from "./sketchfixedaxes.ts";
import { parseValue } from "./dimedit.ts";
import { entryText } from "./numberformat.ts";
import { showNumber } from "./precision.ts";
import { pushUndo } from "./sketchundo.ts";
import { changeConstraints } from "./sketchconstrain.ts";
import { resolveSketch } from "./sketchrefresh.ts";
import { renderSketch } from "./sketchrender.ts";
import type { SketchMode } from "./sketch.ts";

/** A number field on the sketch at a dimension's text. Enter sets the value (one undo step, or none more when `fresh`: the
 * constraint was just created and its creation is the step); Escape or clicking away leaves the value as it is. */
export function editInline(mode: SketchMode, id: number, at: { x: number; y: number }, fresh = false) {
  mode.valueField?.remove();
  const c = mode.s.constraints.find((x) => x.id === id);
  if (!c || c.value === undefined) return;
  const box = document.createElement("div");
  box.style.cssText = `position:absolute;left:${at.x}px;top:${at.y}px;transform:translate(-50%,-50%);z-index:20;font:13px system-ui,sans-serif`;
  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "decimal";
  input.setAttribute("aria-label", M.describeConstraint(mode.s, c).replace(/ = .*$/, ""));
  input.style.cssText = "width:78px;padding:2px 5px;font:inherit;color:#ff8a1f;background:#1b1d22;border:1px solid #ff8a1f;border-radius:3px;outline:none;text-align:center";
  input.value = entryText(showNumber(c.value));
  box.append(input);
  for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick"]) box.addEventListener(type, (e) => e.stopPropagation());
  let closed = false;
  const close = () => {
    if (closed) return; // removing the field blurs it, which calls this again
    closed = true;
    box.remove();
    if (mode.valueField === box) mode.valueField = null;
  };
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const value = parseValue(input.value);
      if (value === null) {
        input.style.borderColor = "#ff4d4d";
        return;
      }
      close();
      const change = (cs: M.SketchConstraint[]) => cs.map((x) => (x.id === id ? { ...x, value } : x));
      const failure = "That value conflicts with other constraints, so it was not changed";
      if (!fresh) void changeConstraints(mode, change, failure);
      else {
        const before = JSON.stringify(mode.s);
        mode.s.constraints = change(mode.s.constraints);
        void resolveSketch(mode).then(async (ok) => {
          if (!ok) {
            mode.s = JSON.parse(before);
            await resolveSketch(mode);
            mode.host.status(failure, true);
          }
          renderSketch(mode);
        });
      }
    }
  });
  input.addEventListener("blur", close);
  mode.valueField = box;
  mode.viewport.renderer.domElement.parentElement!.append(box);
  input.focus();
  input.select();
}

/** Change the value of an existing dimension; a value the other constraints refuse is undone. */
export async function editDimension(mode: SketchMode, id: number) {
  const c = mode.s.constraints.find((x) => x.id === id);
  if (!c || c.value === undefined) return;
  const answer = await mode.askNumber(M.describeConstraint(mode.s, c).replace(/ = .*$/, ""), c.value);
  if (answer === null || answer.reference) return;
  await changeConstraints(mode, (cs) => cs.map((x) => (x.id === id ? { ...x, value: answer.value } : x)), "That value conflicts with other constraints, so it was not changed");
}

export function selectDimension(mode: SketchMode, id: number, additive: boolean) {
  const had = mode.selectedDimensions.has(id);
  if (!additive) mode.selectedDimensions.clear();
  for (const one of id < 0 ? [id] : equalChain(mode.s.constraints, id)) { // an Equal mark selects its whole chain
    if (additive && had) mode.selectedDimensions.delete(one);
    else mode.selectedDimensions.add(one);
  }
  renderSketch(mode, false);
}

/** Right-click on a constraint mark: a Fixed point can be held by its two distances to the axes, and such a pair can be turned back into Fixed. */
export async function markMenu(mode: SketchMode, id: number, e: MouseEvent) {
  const toAxes = fixedToAxes(mode.s, id);
  const toFixed = axesToFixed(mode.s, id);
  const items = [...(toAxes ? [{ label: "Dimension to the axes", to: toAxes }] : []), ...(toFixed ? [{ label: "Fix the point (remove the distances to the axes)", to: toFixed }] : [])];
  const picked = items.length ? await chooseAtCursor({ x: e.clientX, y: e.clientY }, items) : null;
  if (picked) await changeConstraints(mode, () => picked.to, "That conflicts with other constraints, so it was not changed");
}

/** Right-click on a dimension's value: switch it (and the other selected dimensions, when it is one of them) between driving and reference. */
export async function dimensionMenu(mode: SketchMode, id: number, e: MouseEvent) {
  const ids = mode.selectedDimensions.has(id) ? [...mode.selectedDimensions] : [id];
  if (!mode.selectedDimensions.has(id)) {
    mode.selectedDimensions.clear();
    mode.selectedDimensions.add(id);
    renderSketch(mode, false);
  }
  const dims = mode.s.constraints.filter((c) => ids.includes(c.id) && c.value !== undefined);
  const items: { label: string; reference?: boolean; switchRound?: boolean; toFixed?: M.SketchConstraint[] }[] = [];
  const toFixed = axesToFixed(mode.s, id);
  if (toFixed) items.push({ label: "Fix the point (remove the distances to the axes)", toFixed });
  if (dims.some((c) => !c.reference)) items.push({ label: "Make reference (measure only)", reference: true });
  if (dims.some((c) => c.reference)) items.push({ label: "Make driving", reference: false });
  const rounds = dims.filter((c) => c.type === "radius" || c.type === "diameter");
  if (rounds.length) items.push({ label: rounds.every((c) => c.type === "radius") ? "Show as diameter" : rounds.every((c) => c.type === "diameter") ? "Show as radius" : "Switch radius and diameter", switchRound: true });
  const picked = items.length ? await chooseAtCursor({ x: e.clientX, y: e.clientY }, items) : null;
  if (picked?.toFixed) await changeConstraints(mode, () => picked.toFixed!, "That conflicts with other constraints, so it was not changed");
  else if (picked?.switchRound) switchRoundDimensions(mode, rounds.map((c) => c.id));
  else if (picked) await setReference(mode, dims.map((c) => c.id), picked.reference!);
}

/** Turn radius dimensions into diameter ones and the other way round, keeping the size they hold. */
export function switchRoundDimensions(mode: SketchMode, ids: number[]) {
  pushUndo(mode);
  for (const c of mode.s.constraints) {
    if (!ids.includes(c.id) || c.value === undefined) continue;
    if (c.type === "radius") Object.assign(c, { type: "diameter", value: c.value * 2 });
    else if (c.type === "diameter") Object.assign(c, { type: "radius", value: c.value / 2 });
  }
  void resolveSketch(mode);
  renderSketch(mode);
}

/** Double-click on a reference dimension's value: make it driving, then open its value entry (it stays a reference, and no entry opens, when it cannot drive). */
export async function driveAndEdit(mode: SketchMode, id: number, at: { x: number; y: number }) {
  await setReference(mode, [id], false);
  if (!mode.s.constraints.find((x) => x.id === id)?.reference) editInline(mode, id, at);
}

/** Switch a dimension between driving the shape and only measuring it; a driving one starts from the current measurement. */
export async function toggleReference(mode: SketchMode, id: number) {
  const c = mode.s.constraints.find((x) => x.id === id);
  if (c) await setReference(mode, [id], !c.reference);
}

/** Make dimensions reference (measure only) or driving. A dimension made driving that clashes with the others turns the dimensions it clashes with into reference ones, with a warning. */
export async function setReference(mode: SketchMode, ids: number[], reference: boolean) {
  const wanted = new Set(ids);
  const dims = mode.s.constraints.filter((c) => wanted.has(c.id) && c.value !== undefined && !!c.reference !== reference);
  if (!dims.length) return;
  pushUndo(mode);
  const before = JSON.stringify(mode.s);
  const turn = (c: M.SketchConstraint, toReference: boolean) => {
    const value = M.measure(mode.s, c) ?? c.value;
    if (toReference) Object.assign(c, { reference: true, value });
    else {
      delete c.reference;
      c.value = value;
    }
  };
  for (const c of dims) turn(c, reference);
  let displaced: M.SketchConstraint[] = [];
  let ok = await resolveSketch(mode);
  if (!ok && !reference) {
    displaced = mode.s.constraints.filter((c) => mode.failed.has(c.id) && c.value !== undefined && !c.reference && !wanted.has(c.id));
    for (const c of displaced) turn(c, true);
    ok = displaced.length > 0 && (await resolveSketch(mode));
  }
  if (!ok) {
    mode.s = JSON.parse(before);
    mode.undoStack.pop();
    await resolveSketch(mode);
    mode.host.status("Making that dimension drive the shape conflicts with other constraints that are not dimensions, so it stays a reference", true);
  } else if (displaced.length) {
    mode.host.status(`${displaced.map((c) => M.describeConstraint(mode.s, c)).join("; ")} became a reference dimension because the new driving dimension makes it redundant`, "warn");
  }
  renderSketch(mode);
}

/** Move a dimension's text (and with it the line or leader) to where the pointer is; the first move is one undo step. */
export function dragDimension(mode: SketchMode, id: number, e: PointerEvent) {
  const at = mode.planeUV(e);
  const c = mode.s.constraints.find((x) => x.id === id);
  if (!at || !c) return;
  if (mode.draggedDimension !== id) {
    pushUndo(mode);
    mode.draggedDimension = id;
    window.addEventListener("pointerup", () => (mode.draggedDimension = null), { once: true, capture: true });
  }
  c.place = at;
  if (c.type === "angle" && c.entities?.length === 2) {
    // Dragging the value across the lines switches between the inside angle and the outside one (the supplement, 180 degrees at most).
    const outside = M.angleSideOutside(mode.s, [c.entities[0], c.entities[1]], at);
    if (outside !== null && outside !== !!c.outside) {
      if (outside) c.outside = true;
      else delete c.outside;
      if (c.value !== undefined) c.value = M.measure(mode.s, c) ?? c.value;
      void resolveSketch(mode);
    }
  }
  renderSketch(mode, false);
}
