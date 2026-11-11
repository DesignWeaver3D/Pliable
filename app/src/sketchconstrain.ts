/** Applying a constraint to the sketch selection: the choices offered, the one chosen, and what happens when it conflicts. */
import * as M from "./sketchmodel.ts";
import * as Sn from "./sketchsnap.ts";
import { leaderAngle } from "./sketchleaderangle.ts";
import { chooseAtCursor } from "./sketchmenu.ts";
import { CONSTRAINT_HELP } from "./sketchconstrainthelp.ts";
import { automaticInTheWay } from "./sketchautowin.ts";
import { pushUndo } from "./sketchundo.ts";
import { editInline } from "./sketchdimactions.ts";
import { resolveSketch } from "./sketchrefresh.ts";
import { renderSketch } from "./sketchrender.ts";
import type { SketchMode } from "./sketch.ts";

/** The constraint and dimension buttons of the sketch strip: every one, enabled when the selection takes it. */
export function constraintChoices(mode: SketchMode): { label: string; enabled: boolean }[] {
  return M.allConstraintOptions(mode.s, mode.selection).map((c) => ({ label: c.option.label, enabled: c.enabled }));
}

/** Apply the strip button with this label to the selection. */
export function chooseConstraint(mode: SketchMode, label: string) {
  const chosen = M.allConstraintOptions(mode.s, mode.selection).find((c) => c.option.label === label);
  if (chosen?.enabled || label === M.SMART_DIMENSION.label) void applyConstraint(mode, chosen?.option ?? M.SMART_DIMENSION); // the smart dimension says what to select when nothing fits
  else if (chosen) mode.host.status(`${label} does not fit the current selection. Needs: ${CONSTRAINT_HELP[label]?.needs ?? "a different selection"}`, "warn");
}

export async function applyConstraint(mode: SketchMode, chosen: M.ConstraintOption) {
  let option = chosen;
  if (chosen.choices) {
    // The smart dimension: every fit for the selection; one is applied, several are chosen from a menu at the cursor.
    const fits = chosen.choices(mode.s, mode.selection, Sn.SNAP_PX * mode.pixelAt(0, 0));
    if (!fits.length) return mode.host.status("Select geometry to dimension or constrain: a line, circle or arc, two points, a point and a line or curve, two lines or curves, or three or more items for symmetric, midpoint, equal or collinear", "warn");
    const picked = fits.length === 1 ? fits[0] : await chooseAtCursor(mode.lastPointer, fits);
    if (!picked) return;
    option = picked;
  }
  const built = option.build(mode.s, mode.selection);
  if (!built) return;
  // A dimension is created at once with its current value and opened for editing on the sketch (Escape keeps the value).
  // An angle between two lines is the one nearest the pointer: the sector it was invoked in (the inside or the outside angle).
  if (built.type === "angle" && built.entities) {
    const at = mode.planeUV({ clientX: mode.lastPointer.x, clientY: mode.lastPointer.y } as PointerEvent);
    const outside = at ? M.angleSideOutside(mode.s, [built.entities[0], built.entities[1]], at) : null;
    if (at && outside !== null) {
      built.place = at;
      if (outside) built.outside = true;
    }
  }
  if (option.dimension) built.value = option.initial!(mode.s, mode.selection);
  if (built.type === "angle" && built.outside && built.value !== undefined) built.value = Math.round((M.measure(mode.s, { id: 0, ...built }) ?? built.value) * 1000) / 1000;
  pushUndo(mode);
  const before = JSON.stringify(mode.s);
  const addedIds = new Set<number>();
  const pointerAt = mode.planeUV({ clientX: mode.lastPointer.x, clientY: mode.lastPointer.y } as PointerEvent);
  for (const one of M.constraintsToAdd(option, mode.s, mode.selection)) {
    const angle = one.type === "radius" || one.type === "diameter" ? leaderAngle(mode.s, one.entity, one.type, pointerAt ? { u: pointerAt[0], v: pointerAt[1] } : null) : undefined;
    const added = { id: M.nextId(mode.s), ...one, ...(angle !== undefined ? { angle } : {}), ...(built.value !== undefined ? { value: built.value } : {}), ...(built.type === "angle" ? { place: built.place, outside: built.outside } : {}) };
    mode.s.constraints.push(added);
    addedIds.add(added.id);
  }
  const ok = (await resolveSketch(mode)) || (await userWins(mode, addedIds));
  if (ok) mode.selection = []; // an applied constraint ends the selection it was made from
  if (ok && option.dimension) {
    renderSketch(mode);
    const id = [...addedIds][0];
    mode.afterDraw(() => {
      const at = mode.overlay.labelOfConstraint(id);
      if (at) editInline(mode, id, at, true);
    });
  }
  if (!ok && option.dimension) {
    // A redundant (or clashing) dimension is kept as a reference dimension: it shows the measurement and drives nothing.
    for (const c of mode.s.constraints) if (addedIds.has(c.id)) c.reference = true;
    if (await resolveSketch(mode)) {
      mode.selection = [];
      mode.host.status("That dimension is redundant with the existing constraints, so it was added as a reference dimension (in parentheses). Make it driving from the constraint list or the right-click menu", "warn");
      renderSketch(mode);
      return;
    }
  }
  if (!ok) {
    const named = (ids: (id: number) => boolean) => mode.s.constraints.filter((c) => ids(c.id)).map((c) => M.describeConstraint(mode.s, c));
    const dropped = named((id) => addedIds.has(id));
    const clash = named((id) => mode.failed.has(id) && !addedIds.has(id));
    mode.s = JSON.parse(before);
    mode.undoStack.pop();
    await resolveSketch(mode);
    // There are no reference geometric constraints: a redundant or clashing one is dropped.
    const mirror = dropped.some((d) => d.startsWith("Symmetric")) ? ", for example mirroring two ends of a line that lies along the axis, or two points already held on the mirror line" : "";
    const against = clash.length ? `the existing ${clash.join("; ")}` : `the fixed points and the constraints already on these items${mirror}`;
    mode.host.status(`Dropped ${dropped.join("; ")}: it repeats or conflicts with ${against}`, "warn");
  }
  renderSketch(mode);
}

/** The new constraint made the sketch fail: automatic constraints in the way are removed one at a time until it solves (the user's constraint wins), with a warning. */
export async function userWins(mode: SketchMode, addedIds: Set<number>): Promise<boolean> {
  const mine = mode.s.constraints.filter((c) => addedIds.has(c.id)).map((c) => M.describeConstraint(mode.s, c)).join("; ");
  for (const c of automaticInTheWay(mode.s.constraints, mode.failed, addedIds)) {
    const all = mode.s.constraints;
    const name = M.describeConstraint(mode.s, c);
    mode.s.constraints = all.filter((x) => x.id !== c.id);
    if (await resolveSketch(mode)) {
      mode.host.status(`Removed the automatic ${name} because it repeats or conflicts with the new ${mine}`, "warn");
      return true;
    }
    mode.s.constraints = all;
  }
  await resolveSketch(mode); // the failure is worked out again for the message
  return false;
}

export async function changeConstraints(mode: SketchMode, change: (cs: M.SketchConstraint[]) => M.SketchConstraint[], failure: string) {
  pushUndo(mode);
  const before = JSON.stringify(mode.s);
  mode.s.constraints = change(mode.s.constraints);
  if (!(await resolveSketch(mode))) {
    mode.s = JSON.parse(before);
    mode.undoStack.pop();
    await resolveSketch(mode);
    mode.host.status(failure, true);
  }
  renderSketch(mode);
}
